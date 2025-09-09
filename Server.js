require('dotenv').config();  // Ensure dotenv is loaded at the top
// Load Firebase Admin SDK
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK with service account JSON file
const serviceAccount = path.resolve(__dirname, './firebase-admin-key.json');  // Point to your actual Firebase key JSON file

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin Initialized');
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error);
  process.exit(1);  // Exit if Firebase initialization fails
}

const express = require('express');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

// Payment Gateway Key (Stripe)
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: '1',
    strict: true,
    deprecationErrors: true,
  },
});

let usersCollection;
let tasksCollection;
let WithdrawalsCollection;
let PaymentsCollection;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db('Microtask');
    usersCollection = db.collection('users');
    tasksCollection = db.collection('tasks');
    WithdrawalsCollection = db.collection('withdrawals');
    PaymentsCollection = db.collection('payments');
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ Error connecting to MongoDB:', err);
    process.exit(1);
  }
}

// Express Setup
const app = express();
const port = process.env.PORT || 3000;

// Middleware Setup
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
//user registration
app.post('/api/register', async (req, res) => {
  const { email, password, name, role, profilePictureUrl, uid } = req.body;

  // Check if all required fields are present
  if (!email || !password || !name || !profilePictureUrl || !uid) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Password validation (min length of 8 characters)
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }

  // Role validation (must be one of 'worker', 'buyer', or 'user')
  const validRoles = ['worker', 'buyer', 'user'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid role. Choose either "worker", "buyer", or "user"' });
  }

  try {
    const userExists = await usersCollection.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Set default coins based on role
    let coins = 0;
    if (role === 'worker') coins = 10;
    else if (role === 'buyer') coins = 50;

    const newUser = {
      email,
      password: hashedPassword,
      name,
      role,
      profilePictureUrl,
      coins,
      uid, // Include uid here
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    res.status(201).json({ message: 'User registered successfully', userId: result.insertedId });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Admin route to fetch all users
app.get('/api/admin/users', async (req, res) => {
  try {
    // Fetch all users from the collection
    const users = await usersCollection.find({}).toArray();

    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found' });
    }

    res.status(200).json({ users });
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// General route to fetch all users (optional, if needed)
app.get('/api/users', async (req, res) => {
  try {
    // Fetch all users from the collection
    const users = await usersCollection.find({}).toArray();
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found' });
    }

    res.status(200).json({ users });
  } catch (err) {
    console.error('❌ Error fetching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/admin/stats', async (req, res) => {
  try {
    const stats = {
      totalWorkers: 100,  // Example data
      totalBuyers: 200,   // Example data
      totalCoins: 5000,   // Example data
      totalPayments: 10000 // Example data
    };
    res.status(200).json(stats); // Send stats as JSON response
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// User Login Route
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    res.status(200).json({ message: 'Login successful', user: { email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Get User Role and Coins Route
app.get('/api/users/:email/role', async (req, res) => {
  
  const userEmail = req.params.email;
  try {
    const user = await usersCollection.findOne({ email: userEmail });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const coins = user.coins || 0;
    res.status(200).json({ role: user.role, coin: coins });
  } catch (err) {
    console.error('Error fetching user data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Task creation route
app.post('/api/tasks', async (req, res) => {
  const { 
    taskTitle, 
    taskDetail, 
    requiredWorkers, 
    payableAmount, 
    completionDate, 
    submissionInfo, 
    taskImageUrl, 
    userId, 
    buyerName // Add buyerName here
  } = req.body;

  // Check if all required fields are present
  if (!taskTitle || !taskDetail || !requiredWorkers || !payableAmount || !completionDate || !taskImageUrl || !userId || !buyerName) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Save the task to the database
    const taskResult = await tasksCollection.insertOne({
      taskTitle,
      taskDetail,
      requiredWorkers,
      payableAmount,
      completionDate,
      submissionInfo,
      taskImageUrl,
      userId,
      buyerName // Store buyerName in the database
    });

    if (!taskResult.acknowledged) {
      console.error('Failed to insert task for user:', userId);
      return res.status(500).json({ message: 'Failed to create task' });
    }

    res.status(200).json({ message: 'Task created successfully' });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Coin deduction route
app.patch('/api/users/deduct-coins', async (req, res) => {
  const { userId, totalCost } = req.body;

  if (!userId || totalCost === undefined) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Find the user by userId (using uid)
    const user = await usersCollection.findOne({ uid: userId });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.coins < totalCost) {
      return res.status(400).json({ message: 'Insufficient coins' });
    }

    // Deduct the coins from the user's account
    const result = await usersCollection.updateOne(
      { uid: userId },  // Use uid for update
      { $inc: { coins: -totalCost } }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({ message: 'Failed to deduct coins' });
    }

    res.status(200).json({ message: 'Coins deducted successfully' });
  } catch (err) {
    console.error('Error deducting coins:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// api for fetching all task condition
app.get('/api/admin/tasks', async (req, res) => {
  try {
    const tasks = await tasksCollection.find({}).sort({ completionDate: -1 }).toArray();
    
    if (tasks.length === 0) {
      return res.status(404).json({ message: 'No tasks found' });
    }
    
    res.status(200).json({ tasks });
  } catch (err) {
    console.error('❌ Error fetching tasks:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
// Update task API
app.patch('/api/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const { taskTitle, taskDetail, submissionInfo } = req.body;

  // Validate the request body
  if (!taskTitle || !taskDetail || !submissionInfo) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Update the task in the database
    const updatedTask = await tasksCollection.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: { taskTitle, taskDetail, submissionInfo } }
    );

    if (updatedTask.modifiedCount === 0) {
      return res.status(404).json({ message: 'Task not found or no changes made' });
    }

    res.status(200).json({ message: 'Task updated successfully' });
  } catch (err) {
    console.error('❌ Error updating task:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Delete task API and update coins for uncompleted tasks
app.delete('/api/tasks/:taskId', async (req, res) => {
  const { taskId } = req.params;

  try {
    // Find the task before deleting to calculate the refill amount
    const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) });

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Calculate refill amount (requiredWorkers * payableAmount)
    const refillAmount = task.requiredWorkers * task.payableAmount;

    // Update the user's coins (if task is uncompleted)
    if (task.completionDate > new Date()) {
      const user = await usersCollection.findOne({ _id: new ObjectId(task.userId) });
      if (user) {
        await usersCollection.updateOne(
          { _id: new ObjectId(task.userId) },
          { $inc: { coins: refillAmount } }
        );
      }
    }

    // Delete the task from the task collection
    await tasksCollection.deleteOne({ _id: new ObjectId(taskId) });

    res.status(200).json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting task:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
//home Buyer

// Fetch all tasks with a specific condition (e.g., 'pending' status)
app.get('/api/tasks/condition', async (req, res) => {
  const { status } = req.query;  // Condition can be passed as a query parameter (e.g., status)

  try {
    // Fetch tasks based on the condition passed (e.g., status: 'pending')
    const tasks = await tasksCollection.find({ status }).sort({ completionDate: -1 }).toArray();

    if (tasks.length === 0) {
      return res.status(404).json({ message: `No tasks with status ${status} found` });
    }

    res.status(200).json({ tasks });
  } catch (err) {
    console.error('❌ Error fetching tasks based on condition:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
app.get('/api/buyer-dashboard/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    console.log('Fetching tasks for userId:', userId);

    // Fetch all tasks created by the buyer
    const tasks = await tasksCollection.find({ userId }).toArray();
    console.log('Fetched tasks:', tasks); // Log the tasks

    // If no tasks found, return 0 values
    if (tasks.length === 0) {
      return res.status(200).json({ totalTaskCount: 0, pendingTaskCount: 0, totalPayment: 0 });
    }

    // Calculate total task count
    const totalTaskCount = tasks.length;

    // Calculate pending task count (sum of required workers for pending tasks)
    const pendingTasks = tasks.filter(task => task.status === 'pending');
    const pendingTaskCount = pendingTasks.reduce((sum, task) => sum + task.requiredWorkers, 0);

    // Calculate total payment made by the buyer (sum of payable amounts for completed tasks)
    const totalPayment = tasks
      .filter(task => task.status === 'completed')
      .reduce((sum, task) => sum + task.payableAmount, 0);

    res.status(200).json({ totalTaskCount, pendingTaskCount, totalPayment });
  } catch (err) {
    console.error('❌ Error fetching buyer dashboard data:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
//dash count
app.get('/api/buyer-reviews/:userId', async (req, res) => {
  const userId = req.params.userId;

  try {
    console.log('Fetching tasks for reviews for userId:', userId);

    // Fetch all tasks added by the buyer
    const tasks = await tasksCollection.find({ userId }).toArray();
    console.log('Fetched tasks for reviews:', tasks); // Log the tasks

    // Filter pending submissions from tasks
    const pendingSubmissions = tasks
      .filter(task => task.status === 'pending')
      .map(task => ({
        ...task,
        submissions: task.submissions.filter(submission => submission.status === 'pending')
      }));

    res.status(200).json({ pendingSubmissions });
  } catch (err) {
    console.error('❌ Error fetching tasks to review:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
// Approve task submission and increase worker's coins
app.patch('/api/tasks/approve/:taskId/:submissionId', async (req, res) => {
  const { taskId, submissionId } = req.params;

  try {
    // Update submission status to 'approved'
    const updatedSubmission = await tasksCollection.updateOne(
      { _id: new ObjectId(taskId), 'submissions._id': new ObjectId(submissionId) },
      { 
        $set: {
          'submissions.$.status': 'approved'
        }
      });

    if (!updatedSubmission.modifiedCount) {
      return res.status(404).json({ message: 'Submission not found or already approved' });
    }

    // Find the worker and update their coins
    const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) });
    const workerId = task.submissions.find(submission => submission._id.toString() === submissionId).workerId;
    
    await usersCollection.updateOne(
      { _id: new ObjectId(workerId) },
      { $inc: { coins: task.payableAmount } } // Increase worker's coins by payable amount
    );

    res.status(200).json({ message: 'Submission approved and worker coins updated' });
  } catch (err) {
    console.error('❌ Error approving task submission:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
// Reject task submission and update required workers count
app.patch('/api/tasks/reject/:taskId/:submissionId', async (req, res) => {
  const { taskId, submissionId } = req.params;

  try {
    // Update submission status to 'rejected'
    const updatedSubmission = await tasksCollection.updateOne(
      { _id: new ObjectId(taskId), 'submissions._id': new ObjectId(submissionId) },
      { 
        $set: {
          'submissions.$.status': 'rejected'
        }
      });

    if (!updatedSubmission.modifiedCount) {
      return res.status(404).json({ message: 'Submission not found or already rejected' });
    }

    // Increase required workers for the task
    const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) });
    await tasksCollection.updateOne(
      { _id: new ObjectId(taskId) },
      { $inc: { requiredWorkers: 1 } }
    );

    res.status(200).json({ message: 'Submission rejected and required workers updated' });
  } catch (err) {
    console.error('❌ Error rejecting task submission:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
//Worker part 

// Withdrawal API route to insert a withdrawal request
app.post('/api/withdrawals', async (req, res) => {
  const {
    worker_email,
    worker_name,
    withdrawal_coin,
    withdrawal_amount,
    payment_system,
    account_number,
    withdraw_date,
    status
  } = req.body;

  console.log('Received withdrawal data:', req.body); // Log the received data for debugging

  // Check for missing required fields
  if (!worker_email || !worker_name || !withdrawal_coin || !withdrawal_amount || !payment_system || !account_number || !withdraw_date) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Construct withdrawal record to insert into the database
    const withdrawalRecord = {
      worker_email,
      worker_name,
      withdrawal_coin,
      withdrawal_amount,
      payment_system,
      account_number,
      withdraw_date,
      status: status || 'pending', // Default to 'pending' if not provided
    };

    // Insert the withdrawal record into the 'withdrawals' collection
    const result = await WithdrawalsCollection.insertOne(withdrawalRecord);

    // Check if the insertion was successful
    if (result.acknowledged) {
      return res.status(201).json({ message: 'Withdrawal request submitted successfully!' });
    } else {
      return res.status(500).json({ message: 'Failed to submit withdrawal request' });
    }
  } catch (err) {
    // Log error if any and return 500 error to client
    console.error('Error processing withdrawal:', err);
    return res.status(500).json({ message: 'Error processing withdrawal' });
  }
});
// Admin route to fetch all withdrawal requests
app.get('/api/admin/withdraw-requests', async (req, res) => {
  try {
    const withdrawals = await WithdrawalsCollection.find({}).toArray();
    res.status(200).json(withdrawals);
  } catch (err) {
    console.error('Error fetching withdrawal requests:', err);
    res.status(500).json({ message: 'Error fetching withdrawal requests' });
  }
});

// Fetch withdrawals by worker email
app.get('/api/withdrawals/:workerEmail', async (req, res) => {
  const { workerEmail } = req.params;  // Extract worker_email from request parameters

  try {
    // Query the withdrawals collection to find all withdrawals for the worker email
    const withdrawals = await WithdrawalsCollection.find({ worker_email: workerEmail }).toArray();

    // If no withdrawals are found for the worker, send a 404 response
    if (withdrawals.length === 0) {
      return res.status(404).json({ message: 'No withdrawals found for this worker' });
    }

    // Send the list of withdrawals as the response
    res.status(200).json({ withdrawals });
  } catch (err) {
    // Log any error and send a 500 response
    console.error('Error fetching withdrawals:', err);
    res.status(500).json({ message: 'Error fetching withdrawals' });
  }
});
// Worker Dashboard API (Modified)
app.get('/api/worker-home/:workerEmail', async (req, res) => {
  const { workerEmail } = req.params;  // Extract worker_email from request parameters

  try {
    // Fetch all withdrawals for the worker
    const withdrawals = await WithdrawalsCollection.find({ worker_email: workerEmail }).toArray();

    // Calculate total withdrawals count
    const totalWithdrawals = withdrawals.length;

    // Calculate total pending withdrawals count
    const totalPendingWithdrawals = withdrawals.filter(withdrawal => withdrawal.status === 'pending').length;

    // Calculate total earnings from withdrawals (sum of withdrawal_amount where status is approved)
    const totalEarningsFromWithdrawals = withdrawals
      .filter(withdrawal => withdrawal.status === 'approved')
      .reduce((total, withdrawal) => total + withdrawal.withdrawal_amount, 0);

    // Send response with data
    res.status(200).json({
      totalWithdrawals,
      totalPendingWithdrawals,
      totalEarningsFromWithdrawals,
      withdrawals: withdrawals.map((withdrawal) => ({
        withdrawal_date: new Date(withdrawal.withdraw_date).toLocaleDateString(),
        withdrawal_amount: withdrawal.withdrawal_amount,
        payment_system: withdrawal.payment_system,
        account_number: withdrawal.account_number,
        status: withdrawal.status,
      })),
    });
  } catch (err) {
    console.error('Error fetching worker home data:', err);
    res.status(500).json({ message: 'Error fetching worker home data' });
  }
});
// Admin route to process payment and update status
app.post('/api/admin/payment-success', async (req, res) => {
    const { withdrawalId, userId, amount, paymentInfo } = req.body;

    console.log('Received payment approval request:', req.body); // Log for debugging

    if (!withdrawalId || !userId || !amount || !paymentInfo) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    try {
        // Fetch the withdrawal request to get worker's email and other details
        const withdrawal = await WithdrawalsCollection.findOne({ _id: new ObjectId(withdrawalId) });
        if (!withdrawal) {
            return res.status(404).json({ message: 'Withdrawal request not found' });
        }

        // Save the approved payment data in the payments collection
        const paymentData = {
            worker_email: withdrawal.worker_email,
            worker_name: withdrawal.worker_name,
            withdrawal_coin: withdrawal.withdrawal_coin,
            withdrawal_amount: withdrawal.withdrawal_amount,
            payment_system: withdrawal.payment_system,
            account_number: withdrawal.account_number,
            withdraw_date: withdrawal.withdraw_date,
            status: 'approved',
            payment_info: paymentInfo,  // Add payment info (transaction ID, payment method, etc.)
            payment_date: new Date(),   // Add payment date
        };

        const paymentResult = await PaymentsCollection.insertOne(paymentData);
        
        if (!paymentResult.acknowledged) {
            return res.status(500).json({ message: 'Failed to save payment' });
        }

        // Deduct the coins from the worker's account
        const user = await usersCollection.findOne({ email: userId }); // Fetch user by email
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.coins < withdrawal.withdrawal_coin) {
            return res.status(400).json({ message: 'Insufficient coins to approve payment' });
        }

        // Deduct the coins from the worker's account
        await usersCollection.updateOne(
            { email: userId },  // Use email for user identification
            { $inc: { coins: -withdrawal.withdrawal_coin } }
        );

        // Update the withdrawal request status to 'payment done'
        await WithdrawalsCollection.updateOne(
            { _id: new ObjectId(withdrawalId) },
            { $set: { status: 'payment done' } }
        );

        res.status(200).json({ message: 'Payment approved and recorded successfully' });
    } catch (error) {
        console.error('Error processing payment approval:', error);
        res.status(500).json({ message: 'Error processing payment approval' });
    }
});



// Sample route
app.get('/', (req, res) => {
  res.send('Parcel Server is running');
});



// Start the server
connectDB().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running at :${port}`);
  });
});

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, 'firebase-admin-key2.json');
admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

// MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}.mongodb.net/?retryWrites=true&w=majority`;
let client;
let usersCollection;
let tasksCollection;
let withdrawCollection;

async function connectDB() {
  try {
    client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db('Microtask');
    usersCollection = db.collection('users');
    tasksCollection = db.collection('tasks');
    withdrawCollection = db.collection('withdrawals');

    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ Error connecting to MongoDB:', err);
    process.exit(1);
  }
}

// JWT Middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Access Denied: No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Access Denied: Invalid token' });
    req.user = decoded;
    next();
  });
};

// Routes
// User Registration
app.post('/api/register', async (req, res) => {
  const { email, password, name, role, profilePictureUrl } = req.body;

  if (!email || !password || !name || !profilePictureUrl) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const userExists = await usersCollection.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Set default coins based on role
    let coins = 0;
    if (role === 'worker') {
      coins = 10;
    } else if (role === 'buyer') {
      coins = 50;
    }

    const newUser = {
      email,
      password: hashedPassword,
      name,
      role: role || 'user',
      profilePictureUrl,
      coins,  // Add the coins field
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(newUser);
    res.status(201).json({ message: 'User registered successfully', userId: result.insertedId });
  } catch (err) {
    console.error('❌ Error creating user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    const token = jwt.sign({ userId: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get User Role
app.get('/api/users/:email/role', async (req, res) => {
  const userEmail = req.params.email;
  try {
    const user = await usersCollection.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ role: user.role });
  } catch (err) {
    console.error('Error fetching user role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Update user's coins after completing a task
app.post('/api/users/update-coins', async (req, res) => {
  const { email, coinsChange } = req.body;  // coinsChange will be positive or negative
  
  if (!email || coinsChange === undefined) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Update the user's coins
    const updatedCoins = user.coins + coinsChange;
    await usersCollection.updateOne(
      { email },
      { $set: { coins: updatedCoins } }
    );

    res.status(200).json({ message: 'Coins updated successfully', coins: updatedCoins });
  } catch (err) {
    console.error('❌ Error updating coins:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
//add task

app.post('/api/tasks', authenticateJWT, async (req, res) => {
  const { task_title, task_detail, required_workers, payable_amount, completion_date, submission_info, task_image_url } = req.body;

  // Log the incoming data
  console.log('Data received at server:', req.body);

  if (!task_title || !task_detail || !required_workers || !payable_amount || !completion_date || !submission_info) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    const newTask = {
      task_title,
      task_detail,
      required_workers,
      payable_amount,
      completion_date,
      submission_info,
      task_image_url,
      createdAt: new Date(),
    };

    const result = await tasksCollection.insertOne(newTask);

    // Log the result of the insertion
    console.log('Task inserted:', result);

    res.status(201).json({ message: 'Task added successfully', taskId: result.insertedId });
  } catch (err) {
    console.error('Error adding task:', err);
    res.status(500).json({ message: 'Server error' });
  }
});





// Admin Stats Route
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalWorkers = await usersCollection.countDocuments({ role: 'worker' });
    const totalBuyers = await usersCollection.countDocuments({ role: 'buyer' });
    const totalCoins = await usersCollection.aggregate([{ $group: { _id: null, totalCoins: { $sum: "$coins" } } }]).toArray();
    const totalPayments = await withdrawCollection.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, totalPayments: { $sum: "$amount" } } }]).toArray();

    res.status(200).json({
      totalWorkers,
      totalBuyers,
      totalCoins: totalCoins[0]?.totalCoins || 0,
      totalPayments: totalPayments[0]?.totalPayments || 0,
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin Withdrawal Requests Route
app.get('/api/admin/withdraw-requests', async (req, res) => {
  try {
    const requests = await withdrawCollection.find({ status: 'pending' }).toArray();
    res.status(200).json(requests);
  } catch (err) {
    console.error('Error fetching withdrawal requests:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin Payment Success Route
app.post('/api/admin/payment-success', async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;

  try {
    // Update the withdrawal status to approved
    await withdrawCollection.updateOne({ _id: withdrawalId }, { $set: { status: 'approved' } });

    // Decrease user's coin balance
    await usersCollection.updateOne({ _id: userId }, { $inc: { coins: -amount } });

    res.status(200).json({ message: 'Payment approved and user coins updated' });
  } catch (err) {
    console.error('Error processing payment:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Admin Routes for User Management
// Get all users
app.get('/api/admin/users', authenticateJWT, async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.status(200).json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Remove user
app.post('/api/admin/remove-user', authenticateJWT, async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  try {
    // Remove the user from the database
    await usersCollection.deleteOne({ _id: new MongoClient.ObjectID(userId) });
    res.status(200).json({ message: 'User removed successfully' });
  } catch (err) {
    console.error('Error removing user:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update User Role
app.post('/api/admin/update-role', authenticateJWT, async (req, res) => {
  const { userId, newRole } = req.body;

  if (!userId || !newRole) {
    return res.status(400).json({ message: 'User ID and new role are required' });
  }

  try {
    // Update user role
    const result = await usersCollection.updateOne(
      { _id: new MongoClient.ObjectID(userId) },
      { $set: { role: newRole } }
    );

    if (result.modifiedCount === 1) {
      res.status(200).json({ message: 'User role updated successfully' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Start Server
connectDB().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running at :${port}`);
  });
});

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
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

async function connectDB() {
  try {
    client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db('Microtask');
    usersCollection = db.collection('users');
    tasksCollection = db.collection('tasks');
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ Error connecting to MongoDB:', err);
    process.exit(1);
  }
}

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'Access Denied: No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Access Denied: Invalid or expired token' });
    }

    req.user = decoded;
    next();
  });
};

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
      coins,
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

// Get Role and Coins
app.get('/api/users/:email/role', async (req, res) => {
  const userEmail = req.params.email;
  try {
    const user = await usersCollection.findOne({ email: userEmail });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const coins = user.coins !== undefined && user.coins !== null ? user.coins : 0;

    res.status(200).json({ 
      role: user.role,
      coin: coins 
    });
  } catch (err) {
    console.error('Error fetching user data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST API to create a new task and deduct coins
app.post('/api/add-task', authenticateJWT, async (req, res) => {
  const { task_title, task_detail, required_workers, payable_amount, completion_date, submission_info, task_image_url } = req.body;

  if (!task_title || !task_detail || !required_workers || !payable_amount || !completion_date || !submission_info || !task_image_url) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const totalPayableAmount = required_workers * payable_amount;

  try {
    const buyer = await usersCollection.findOne({ _id: ObjectId(req.user.userId) });

    if (!buyer) return res.status(404).json({ message: 'Buyer not found' });

    if (buyer.coins < totalPayableAmount) {
      return res.status(400).json({ message: 'Not enough coins. Please purchase more coins.' });
    }

    const updateResult = await usersCollection.updateOne(
      { _id: ObjectId(req.user.userId) },
      { $inc: { coins: -totalPayableAmount } }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({ message: 'Failed to deduct coins' });
    }

    const newTask = {
      task_title,
      task_detail,
      required_workers,
      payable_amount,
      completion_date,
      submission_info,
      task_image_url,
      created_at: new Date(),
      created_by: req.user.userId,
      status: 'open',
    };

    const result = await tasksCollection.insertOne(newTask);

    if (result.insertedCount === 0) {
      return res.status(500).json({ message: 'Failed to create task' });
    }

    res.status(201).json({ message: 'Task added successfully', taskId: result.insertedId });
  } catch (err) {
    console.error('❌ Error adding task:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Start Server
connectDB().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running at :${port}`);
  });
});

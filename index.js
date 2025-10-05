const express = require('express');
const cors = require('cors');
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const { connectDB } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const programRoutes = require('./routes/programRoutes');
const app = express();

let dbConnectionPromise = connectDB().catch(err => {
    console.error("FATAL: MongoDB connection failed on initial startup.", err);
    process.exit(1); 
});

app.use(cors());
app.use(express.json());
app.use(async (req, res, next) => {
    try {
        await dbConnectionPromise; 
        next(); 
    } catch (error) {
    
        res.status(503).json({ message: "Service Unavailable: Database is not connected." });
    }
});

app.get("/", (req, res) => {
    res.json({ message: "Nexonext API is running successfully." });
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/programs', programRoutes);


module.exports = app;
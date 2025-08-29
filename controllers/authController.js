const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const { ObjectId } = require('mongodb');

// Initial package structure for new users
const initialPackages = {
    "3p": {
      "levels": [
        { "level": 1, "status": "locked", "cost": 10, "unfreezeCost": 5, "currentCircle": 0, "boxes": [] },
        { "level": 2, "status": "locked", "cost": 20, "unfreezeCost": 10, "currentCircle": 0, "boxes": [] },
        { "level": 3, "status": "locked", "cost": 30, "unfreezeCost": 15, "currentCircle": 0, "boxes": [] },
        { "level": 4, "status": "locked", "cost": 40, "unfreezeCost": 20, "currentCircle": 0, "boxes": [] },
        { "level": 5, "status": "locked", "cost": 50, "unfreezeCost": 25, "currentCircle": 0, "boxes": [] },
        { "level": 6, "status": "locked", "cost": 60, "unfreezeCost": 30, "currentCircle": 0, "boxes": [] },
      ]
    },
    "6p": {
      "levels": [
        { "level": 1, "status": "locked", "cost": 15, "unfreezeCost": 7, "currentCircle": 0, "boxes": [] },
        { "level": 2, "status": "locked", "cost": 25, "unfreezeCost": 12, "currentCircle": 0, "boxes": [] },
        { "level": 3, "status": "locked", "cost": 35, "unfreezeCost": 17, "currentCircle": 0, "boxes": [] },
        { "level": 4, "status": "locked", "cost": 45, "unfreezeCost": 22, "currentCircle": 0, "boxes": [] },
        { "level": 5, "status": "locked", "cost": 55, "unfreezeCost": 27, "currentCircle": 0, "boxes": [] },
        { "level": 6, "status": "locked", "cost": 65, "unfreezeCost": 32, "currentCircle": 0, "boxes": [] },
      ]
    },
    "vip": {
      "levels": [
        { "level": 1, "status": "locked", "cost": 50, "unfreezeCost": 50, "currentCircle": 0, "boxes": [] },
        { "level": 2, "status": "locked", "cost": 100, "unfreezeCost": 100, "currentCircle": 0, "boxes": [] },
        { "level": 3, "status": "locked", "cost": 150, "unfreezeCost": 150, "currentCircle": 0, "boxes": [] },
        { "level": 4, "status": "locked", "cost": 200, "unfreezeCost": 200, "currentCircle": 0, "boxes": [] },
        { "level": 5, "status": "locked", "cost": 250, "unfreezeCost": 250, "currentCircle": 0, "boxes": [] },
        { "level": 6, "status": "locked", "cost": 300, "unfreezeCost": 300, "currentCircle": 0, "boxes": [] },
      ]
    }
};

exports.registerUser = async (req, res) => {
    const { name, email, password, referralId } = req.body;
    if (!name || !email || !password) return res.status(400).json({ msg: 'Please enter all fields' });
    const db = getDB();
    try {
        let user = await db.collection('users').findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const myReferralId = uuidv4().split('-')[0];

        const newUser = {
            name,
            email,
            password: hashedPassword,
            myReferralId,
            referredBy: null,
            balance: 0,
            packages: initialPackages,
            createdAt: new Date(),
        };

        if (referralId) {
            const referrer = await db.collection('users').findOne({ myReferralId: referralId });
            if (referrer) newUser.referredBy = referrer._id;
        }

        const result = await db.collection('users').insertOne(newUser);
        res.status(201).json({ msg: 'User registered successfully', userId: result.insertedId });
    } catch (err) { res.status(500).send('Server Error'); }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;
    const db = getDB();
    try {
        const user = await db.collection('users').findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

        const payload = { user: { id: user._id.toString() } };

        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' }, (err, token) => {
            if (err) throw err;
            res.json({ token });
        });
    } catch (err) { res.status(500).send('Server Error'); }
};

exports.getUser = async (req, res) => {
    const db = getDB();
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) }, { projection: { password: 0 } });
        res.json(user);
    } catch (err) {
        res.status(500).send('Server Error');
    }
};
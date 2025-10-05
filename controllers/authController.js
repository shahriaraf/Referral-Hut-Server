const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDB } = require("../config/db");
const { v4: uuidv4 } = require("uuid");
const { ObjectId } = require("mongodb");

const initialPackagesForUser = {
    "3p": {
        levels: Array.from({ length: 6 }, (_, i) => ({
            level: i + 1,
            status: "locked",
            currentCircle: 0,
            boxes: [],
        })),
    },
    "6p": {
        levels: Array.from({ length: 6 }, (_, i) => ({
            level: i + 1,
            status: "locked",
            currentCircle: 0,
            boxes: [],
        })),
    },
};

exports.registerUser = async (req, res) => {
    const { name, email, password, referralId } = req.body;
    if (!name || !email || !password)
        return res.status(400).json({ msg: "Please enter all fields" });
    const db = getDB();
    try {
        let user = await db.collection("users").findOne({ email });
        if (user) return res.status(400).json({ msg: "User already exists" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const myReferralId = uuidv4().split("-")[0];

        const newUser = {
            name,
            email,
            password: hashedPassword,
            myReferralId,
            referredBy: null,
            balance: 0,
            role: "user",
            packages: initialPackagesForUser,
            createdAt: new Date(),
        };

        if (referralId) {
            const referrer = await db
                .collection("users")
                .findOne({ myReferralId: referralId });
            if (referrer) newUser.referredBy = referrer._id;
        }

        const result = await db.collection("users").insertOne(newUser);
        res
            .status(201)
            .json({ msg: "User registered successfully", userId: result.insertedId });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
};

exports.loginUser = async (req, res) => {
    const { email, password } = req.body;
    const db = getDB();
    try {
        const user = await db.collection("users").findOne({ email });
        if (!user) return res.status(400).json({ msg: "Invalid credentials" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

        const payload = { user: { id: user._id.toString(), role: user.role } };

        jwt.sign(
            payload,
            process.env.JWT_SECRET, { expiresIn: "24h" },
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
};

exports.getUser = async (req, res) => {
    const db = getDB();
    const userId = new ObjectId(req.user.id);
    try {
        const user = await db
            .collection("users")
            .findOne({ _id: userId }, { projection: { password: 0 } });

        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }

        // --- NEW LOGIC START ---
        // Calculate the sum of all pending withdrawals for this user
        const pendingWithdrawalsResult = await db.collection('withdrawals').aggregate([
            { $match: { userId: userId, status: 'pending' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();

        // Add the pending total to the user object
        user.pendingWithdrawalsTotal = pendingWithdrawalsResult.length > 0 ? pendingWithdrawalsResult[0].total : 0;
        // --- NEW LOGIC END ---

        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
};

exports.getAdminReferralId = async (req, res) => {
    const db = getDB();
    try {
        // Find the first user with the role of 'admin'
        const adminUser = await db.collection('users').findOne({ role: 'admin' });

        if (!adminUser || !adminUser.myReferralId) {
            // If no admin or admin has no referral ID, return a not found error
            return res.status(404).json({ msg: 'Admin referral ID not found.' });
        }

        // Return only the referral ID
        res.json({ referralId: adminUser.myReferralId });

    } catch (err) {
        console.error("Error fetching admin referral ID:", err.message);
        res.status(500).send("Server Error");
    }
};
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

exports.handleDeposit = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'Invalid deposit ID format.' });
    }
    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ msg: 'Invalid status provided.' });
    }

    const db = getDB();
    try {
        const deposit = await db.collection('deposits').findOne({ _id: new ObjectId(id) });
        if (!deposit) {
            return res.status(404).json({ msg: 'Deposit request not found' });
        }
        if (deposit.status !== 'pending') {
            return res.status(400).json({ msg: `This deposit has already been ${deposit.status}.` });
        }
        if (status === 'accepted') {
            await db.collection('users').updateOne({ _id: new ObjectId(deposit.userId) }, { $inc: { balance: deposit.amount } });
        }
        await db.collection('deposits').updateOne({ _id: new ObjectId(id) }, { $set: { status: status } });

        res.json({ msg: `Deposit has been successfully ${status}.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

exports.handleWithdrawal = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'Invalid withdrawal ID format.' });
    }
    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ msg: 'Invalid status provided.' });
    }

    const db = getDB();
    try {
        const withdrawal = await db.collection('withdrawals').findOne({ _id: new ObjectId(id) });
        if (!withdrawal) {
            return res.status(404).json({ msg: 'Withdrawal request not found' });
        }
        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ msg: `This withdrawal has already been ${withdrawal.status}.` });
        }
        if (status === 'accepted') {
            const user = await db.collection('users').findOne({ _id: new ObjectId(withdrawal.userId) });
            if (!user || user.balance < withdrawal.amount) {
                await db.collection('withdrawals').updateOne({ _id: new ObjectId(id) }, { $set: { status: 'declined', reason: 'Insufficient balance at time of approval' } });
                return res.status(400).json({ msg: 'User has insufficient balance. Withdrawal declined.' });
            }
            await db.collection('users').updateOne({ _id: new ObjectId(withdrawal.userId) }, { $inc: { balance: -withdrawal.amount } });
        }
        await db.collection('withdrawals').updateOne({ _id: new ObjectId(id) }, { $set: { status: status } });

        res.json({ msg: `Withdrawal has been successfully ${status}.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

exports.getDeposits = async (req, res) => {
    const db = getDB();
    try {
        // --- ADD `status` HERE ---
        const { search, status } = req.query; 
        let query = {};

        // --- ADD THIS BLOCK ---
        if (status && status !== 'all') {
            query.status = status;
        }
        // --- END ADDED BLOCK ---

        if (search) {
            query.$or = [
                { userEmail: { $regex: search, $options: 'i' } },
                { transactionId: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const deposits = await db.collection('deposits').find(query).sort({ createdAt: -1 }).toArray();
        res.json(deposits);

    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

exports.getWithdrawals = async (req, res) => {
    const db = getDB();
    try {
        const { status, search } = req.query;
        let query = {};
        if (status && status !== 'all') {
            query.status = status;
        }
        if (search) {
            query.$or = [
                { userEmail: { $regex: search, $options: 'i' } },
                { accountNumber: { $regex: search, $options: 'i' } },
            ];
        }
        const withdrawals = await db.collection('withdrawals').find(query).sort({ createdAt: -1 }).toArray();
        res.json(withdrawals);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

exports.getWithdrawalStats = async (req, res) => {
    const db = getDB();
    try {
        const stats = await db.collection('withdrawals').aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]).toArray();

        const formattedStats = stats.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
        }, { pending: 0, accepted: 0, declined: 0 });

        res.json(formattedStats);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

exports.getLevelsByProgram = async (req, res) => {
    const db = getDB();
    try {
        const programKey = req.params.programKey;
        const program = await db.collection("Levels").findOne({ key: programKey });
        if (!program) return res.status(404).json({ message: "Program not found" });
        res.json({ levels: program.levels || [] });
    } catch (error) {
        console.error("Error fetching levels:", error);
        res.status(500).json({ message: "Server error", error });
    }
};

exports.getAllPrograms = async (req, res) => {
    const db = getDB();
    try {
        const programs = await db.collection("Levels").find({}).toArray();
        if (!programs || programs.length === 0) {
            return res.status(404).json({ message: "No programs found" });
        }
        res.json({ programs });
    } catch (error) {
        console.error("Error fetching programs:", error);
        res.status(500).json({ message: "Server error", error });
    }
};

exports.updateLevelPrice = async (req, res) => {
    const { programKey, levelNumber } = req.params;
    const { price } = req.body;
    const db = getDB();

    if (price === undefined || isNaN(parseFloat(price))) {
        return res.status(400).json({ msg: 'A valid price must be provided.' });
    }

    try {
        const result = await db.collection('Levels').updateOne({ key: programKey, "levels.level": parseInt(levelNumber) }, { $set: { "levels.$.price": parseFloat(price), "levels.$.updatedAt": new Date() } });

        if (result.modifiedCount === 0) {
            return res.status(404).json({ msg: 'Level not found or price unchanged' });
        }
        res.json({ msg: 'Level price updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
    }
};

exports.getAllUsers = async (req, res) => {
    const db = getDB();
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const searchTerm = req.query.search || "";
        let query = {};

        if (searchTerm) {
            query = {
                $or: [
                    { name: { $regex: searchTerm, $options: 'i' } },
                    { email: { $regex: searchTerm, $options: 'i' } }
                ]
            };
        }
        const [users, totalUsers] = await Promise.all([
            db.collection('users').find(query, { projection: { password: 0 } }).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            db.collection('users').countDocuments(query)
        ]);
        const totalPages = Math.ceil(totalUsers / limit);

        res.json({ users, currentPage: page, totalPages, totalUsers });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.sendGiftToUser = async (req, res) => {
    const { id } = req.params;
    const { amount } = req.body;
    const db = getDB();

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'Invalid user ID format.' });
    }
    const giftAmount = parseFloat(amount);
    if (isNaN(giftAmount) || giftAmount <= 0) {
        return res.status(400).json({ msg: 'Invalid amount provided. Must be a positive number.' });
    }

    try {
        const result = await db.collection('users').updateOne({ _id: new ObjectId(id) }, { $inc: { balance: giftAmount } });

        if (result.matchedCount === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }
        await db.collection('gift_logs').insertOne({
            adminId: new ObjectId(req.user.id),
            recipientId: new ObjectId(id),
            amount: giftAmount,
            timestamp: new Date()
        });
        res.json({ msg: `Successfully gifted $${giftAmount} to the user.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    const db = getDB();

    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'Invalid user ID format.' });
    }

    try {
        if (req.user.id === id) {
            return res.status(400).json({ msg: "You cannot delete your own account." });
        }
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }
        res.json({ msg: 'User deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

/**
 * @route   GET /api/admin/deposits
 * @desc    Get all pending deposit requests
 * @access  Private (Admin)
 */
exports.getDeposits = async (req, res) => {
    const db = getDB();
    try {
        // শুধুমাত্র পেন্ডিং স্ট্যাটাসের ডিপোজিটগুলো খুঁজে বের করা হচ্ছে
        const deposits = await db.collection('deposits').find({ status: 'pending' }).sort({ createdAt: -1 }).toArray();
        res.json(deposits);
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

/**
 * @route   PUT /api/admin/deposits/:id
 * @desc    Handle a deposit request (accept or decline)
 * @access  Private (Admin)
 */
exports.handleDeposit = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'accepted' or 'declined'

    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ msg: 'Invalid status provided.' });
    }

    const db = getDB();
    try {
        const deposit = await db.collection('deposits').findOne({ _id: new ObjectId(id) });
        if (!deposit) {
            return res.status(404).json({ msg: 'Deposit request not found' });
        }

        // অনুরোধটি যদি আর 'pending' না থাকে তবে কোনো ব্যবস্থা নেওয়া যাবে না
        if (deposit.status !== 'pending') {
            return res.status(400).json({ msg: `This deposit has already been ${deposit.status}.` });
        }

        if (status === 'accepted') {
            // ডিপোজিট قبول করা হলে ইউজারের ব্যালেন্স বাড়ানো হচ্ছে
            await db.collection('users').updateOne(
                { _id: new ObjectId(deposit.userId) }, 
                { $inc: { balance: deposit.amount } }
            );
        }

        // ডিপোজিট অনুরোধের স্ট্যাটাস আপডেট করা হচ্ছে
        await db.collection('deposits').updateOne(
            { _id: new ObjectId(id) }, 
            { $set: { status: status } }
        );

        res.json({ msg: `Deposit has been successfully ${status}.` });
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

/**
 * @route   GET /api/admin/withdrawals
 * @desc    Get all pending withdrawal requests
 * @access  Private (Admin)
 */
exports.getWithdrawals = async (req, res) => {
    const db = getDB();
    try {
        // শুধুমাত্র পেন্ডিং স্ট্যাটাসের উইথড্রগুলো খুঁজে বের করা হচ্ছে
        const withdrawals = await db.collection('withdrawals').find({ status: 'pending' }).sort({ createdAt: -1 }).toArray();
        res.json(withdrawals);
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

/**
 * @route   PUT /api/admin/withdrawals/:id
 * @desc    Handle a withdrawal request (accept or decline)
 * @access  Private (Admin)
 */



exports.getLevelsByProgram = async (req, res) => {
  const db = getDB();
  try {
    const programKey = req.params.programKey;
    console.log('Route hit:', programKey);

    // Debug: list collections
    const collections = await db.listCollections().toArray();
    console.log('Collections in DB:', collections.map(c => c.name));

    const program = await db.collection("Levels").findOne({ key: programKey });
    console.log('Found program:', program);

    if (!program) return res.status(404).json({ message: "Program not found" });

    res.json({ levels: program.levels || [] });
  } catch (error) {
    console.error("Error fetching levels:", error);
    res.status(500).json({ message: "Server error", error });
  }
};


// একক লেভেলের দাম আপডেট
// adminController.js// adminController.js
exports.updateLevelPrice = async (req, res) => {
  const { programKey, levelNumber } = req.params;
  const { price } = req.body;
  const db = getDB();

  try {
    const result = await db.collection('Levels').updateOne(
      { key: programKey, "levels.level": parseInt(levelNumber) },
      { $set: { "levels.$.price": price, "levels.$.updatedAt": new Date() } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ msg: 'Level not found or price unchanged' });
    }

    res.json({ msg: 'Level price updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
};



exports.handleWithdrawal = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'accepted' or 'declined'

    if (!['accepted', 'declined'].includes(status)) {
        return res.status(400).json({ msg: 'Invalid status provided.' });
    }

    const db = getDB();
    try {
        const withdrawal = await db.collection('withdrawals').findOne({ _id: new ObjectId(id) });
        if (!withdrawal) {
            return res.status(404).json({ msg: 'Withdrawal request not found' });
        }

        // অনুরোধটি যদি আর 'pending' না থাকে তবে কোনো ব্যবস্থা নেওয়া যাবে না
        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ msg: `This withdrawal has already been ${withdrawal.status}.` });
        }
        
        if (status === 'accepted') {
            // টাকা কাটার আগে ইউজারের বর্তমান ব্যালেন্স আবার চেক করা হচ্ছে
            const user = await db.collection('users').findOne({ _id: new ObjectId(withdrawal.userId) });
            if (!user || user.balance < withdrawal.amount) {
                // যদি ব্যালেন্স অপর্যাপ্ত হয়, অনুরোধটি স্বয়ংক্রিয়ভাবে decline করে দেওয়া হবে
                await db.collection('withdrawals').updateOne(
                    { _id: new ObjectId(id) }, 
                    { $set: { status: 'declined', reason: 'Insufficient balance at time of approval' } }
                );
                return res.status(400).json({ msg: 'User has insufficient balance. Withdrawal declined.' });
            }
             
            // ব্যালেন্স পর্যাপ্ত থাকলে টাকা কেটে নেওয়া হচ্ছে
            await db.collection('users').updateOne(
                { _id: new ObjectId(withdrawal.userId) }, 
                { $inc: { balance: -withdrawal.amount } }
            );
        }

        // উইথড্র অনুরোধের স্ট্যাটাস আপডেট করা হচ্ছে
        await db.collection('withdrawals').updateOne(
            { _id: new ObjectId(id) }, 
            { $set: { status: status } }
        );
        
        res.json({ msg: `Withdrawal has been successfully ${status}.` });
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};
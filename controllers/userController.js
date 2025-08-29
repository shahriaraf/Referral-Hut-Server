const { getDB } = require('../config/db');
const { ObjectId } = require('mongodb');

/**
 * @route   POST /api/user/deposit
 * @desc    Submit a deposit request
 * @access  Private
 */
exports.submitDeposit = async (req, res) => {
    const { address, transactionId, amount } = req.body;
    const db = getDB();
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });

        const newDeposit = {
            userId: user._id,
            userEmail: user.email,
            address,
            transactionId,
            amount: parseFloat(amount),
            status: 'pending',
            createdAt: new Date(),
        };
        await db.collection('deposits').insertOne(newDeposit);
        res.status(201).json({ msg: 'Deposit request submitted successfully. Please wait for admin approval.' });
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

/**
 * @route   POST /api/user/withdraw
 * @desc    Submit a withdrawal request
 * @access  Private
 */
exports.submitWithdraw = async (req, res) => {
    const { accountType, accountNumber, amount } = req.body;
    const db = getDB();
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
        if (user.balance < amount) {
            return res.status(400).json({ msg: 'Insufficient balance' });
        }
        const newWithdrawal = {
            userId: user._id,
            userEmail: user.email,
            accountType,
            accountNumber,
            amount: parseFloat(amount),
            status: 'pending',
            createdAt: new Date(),
        };
        await db.collection('withdrawals').insertOne(newWithdrawal);
        res.status(201).json({ msg: 'Withdrawal request submitted successfully. Please wait for admin approval.' });
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server error'); 
    }
};

/**
 * @route   POST /api/user/packages/purchase/:program/:level
 * @desc    Purchase a package level
 * @access  Private
 */
exports.purchasePackageLevel = async (req, res) => {
    const { program, level } = req.params;
    const userId = new ObjectId(req.user.id);
    const db = getDB();

    try {
        const buyer = await db.collection('users').findOne({ _id: userId });
        if (!buyer) return res.status(404).json({ msg: 'User not found' });
        
        const levelIndex = parseInt(level) - 1;
        if (!buyer.packages[program] || !buyer.packages[program].levels[levelIndex]) {
            return res.status(400).json({ msg: 'Invalid program or level specified.' });
        }
        
        const packageLevel = buyer.packages[program].levels[levelIndex];

        // --- Validation Checks ---
        if (packageLevel.status !== 'locked') {
            return res.status(400).json({ msg: `This level is already ${packageLevel.status}.` });
        }
        if (buyer.balance < packageLevel.cost) {
            return res.status(400).json({ msg: 'Insufficient balance to purchase this level.' });
        }
        // For 3p and 6p, previous level must be frozen to buy the next one (except for level 1)
        if ((program === '3p' || program === '6p') && levelIndex > 0) {
            const prevLevel = buyer.packages[program].levels[levelIndex - 1];
            if (prevLevel.status !== 'frozen') {
                return res.status(400).json({ msg: `You must complete and freeze Level ${level - 1} before purchasing Level ${level}.` });
            }
        }
        
        // --- Main Purchase Logic ---

        // 1. Deduct cost from buyer's balance
        await db.collection('users').updateOne({ _id: userId }, { $inc: { balance: -packageLevel.cost } });
        
        // 2. Mark level as active for the buyer
        const buyerUpdateField = `packages.${program}.levels.${levelIndex}.status`;
        await db.collection('users').updateOne({ _id: userId }, { $set: { [buyerUpdateField]: 'active' } });

        // 3. Money & Box Distribution Logic
        if (!buyer.referredBy) {
            console.log(`Level purchased by ${buyer.email}. No referrer to credit.`);
            return res.json({ msg: `Level ${level} of ${program} purchased successfully! No referrer to distribute funds to.` });
        }

        const referrer = await db.collection('users').findOne({ _id: new ObjectId(buyer.referredBy) });
        if (!referrer) {
             console.log(`Level purchased by ${buyer.email}. Referrer not found.`);
             return res.json({ msg: 'Level purchased. Referrer not found.' });
        }
        
        // Check if the referrer has activated this level. If not, money goes to their upline.
        // This is a common MLM rule, but based on your description, this check is not needed.
        // We assume money goes to the referrer regardless of their own level status.

        const referrerId = referrer._id;
        const levelCost = packageLevel.cost;

        // Common update fields for the referrer
        const boxUpdateField = `packages.${program}.levels.${levelIndex}.boxes`;
        
        // Add buyer to referrer's box
        await db.collection('users').updateOne({ _id: referrerId }, { $push: { [boxUpdateField]: buyer._id } });
        
        // Get the updated state of the referrer to count boxes
        const updatedReferrer = await db.collection('users').findOne({ _id: referrerId });
        const boxCount = updatedReferrer.packages[program].levels[levelIndex].boxes.length;


        // --- Program-Specific Distribution Logic ---

        if (program === '3p') {
            const circleUpdateField = `packages.${program}.levels.${levelIndex}.currentCircle`;
            const statusUpdateField = `packages.${program}.levels.${levelIndex}.status`;
            
            if (boxCount <= 2) { // Box 1 & 2: Referrer gets paid
                await db.collection('users').updateOne({ _id: referrerId }, { $inc: { balance: levelCost } });
            } else { // Box 3: Upline gets paid, and cycle resets
                const upline = referrer.referredBy ? await db.collection('users').findOne({ _id: new ObjectId(referrer.referredBy) }) : null;
                if (upline) {
                    await db.collection('users').updateOne({ _id: upline._id }, { $inc: { balance: levelCost } });
                }
                
                // Reset cycle
                await db.collection('users').updateOne({ _id: referrerId }, { 
                    $set: { [boxUpdateField]: [] }, 
                    $inc: { [circleUpdateField]: 1 } 
                });
                
                // Freeze after 2nd circle is complete (currentCircle will be 1, after inc it becomes 2)
                if (updatedReferrer.packages[program].levels[levelIndex].currentCircle + 1 >= 2) {
                    await db.collection('users').updateOne({ _id: referrerId }, { $set: { [statusUpdateField]: 'frozen' } });
                }
            }
        } 
        else if (program === '6p') {
            const upline = referrer.referredBy ? await db.collection('users').findOne({ _id: new ObjectId(referrer.referredBy) }) : null;

            if (boxCount <= 2) { // Box 1, 2 -> Upline
                if (upline) {
                    await db.collection('users').updateOne({ _id: upline._id }, { $inc: { balance: levelCost } });
                }
            } else if (boxCount <= 5) { // Box 3, 4, 5 -> Referrer
                await db.collection('users').updateOne({ _id: referrerId }, { $inc: { balance: levelCost } });
            } else { // Box 6 -> Random downline, and cycle resets
                const downlines = await db.collection('users').find({ referredBy: referrerId }).toArray();
                if (downlines.length > 0) {
                    const randomDownline = downlines[Math.floor(Math.random() * downlines.length)];
                    await db.collection('users').updateOne({ _id: randomDownline._id }, { $inc: { balance: levelCost } });
                }
                // Reset cycle
                const circleUpdateField = `packages.${program}.levels.${levelIndex}.currentCircle`;
                await db.collection('users').updateOne({ _id: referrerId }, { 
                    $set: { [boxUpdateField]: [] }, 
                    $inc: { [circleUpdateField]: 1 } 
                });
            }
        } 
        else if (program === 'vip') {
            const statusUpdateField = `packages.${program}.levels.${levelIndex}.status`;
            const upline = referrer.referredBy ? await db.collection('users').findOne({ _id: new ObjectId(referrer.referredBy) }) : null;
            
            const adminShare = levelCost * 0.40;
            const referrerShare = levelCost * 0.40;
            const uplineShare = levelCost * 0.20;

            // Log admin earnings in a separate collection for audit purposes
            await db.collection('admin_earnings').insertOne({
                amount: adminShare, program, level, fromUser: buyer._id, timestamp: new Date()
            });
            
            // Credit referrer
            await db.collection('users').updateOne({ _id: referrerId }, { $inc: { balance: referrerShare } });

            // Credit upline
            if (upline) {
                await db.collection('users').updateOne({ _id: upline._id }, { $inc: { balance: uplineShare } });
            }

            // After 4 boxes, freeze the level (only 1 cycle)
            if (boxCount >= 4) {
                 await db.collection('users').updateOne({ _id: referrerId }, { $set: { [statusUpdateField]: 'frozen' } });
            }
        }
        
        res.json({ msg: `Level ${level} of ${program} purchased successfully! Funds have been distributed.` });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
    }
};
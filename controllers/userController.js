const { getDB, getClient } = require('../config/db');
const { ObjectId } = require('mongodb');

const findEligibleUpline = async (db, startingUserId, program, levelNum, session) => {
    let currentUser = await db.collection('users').findOne({ _id: new ObjectId(startingUserId) }, { session });
    if (!currentUser || !currentUser.referredBy) {
        return null;
    }
    let uplineId = new ObjectId(currentUser.referredBy);
    while (uplineId) {
        const upline = await db.collection('users').findOne({ _id: uplineId }, { session });
        if (!upline) {
            return null;
        }
        const levelIndex = levelNum - 1;
        if (upline.packages[program] && upline.packages[program].levels[levelIndex] && upline.packages[program].levels[levelIndex].status !== 'locked') {
            return upline;
        }
        uplineId = upline.referredBy ? new ObjectId(upline.referredBy) : null;
    }
    return null;
};

const creditAdmin = async (db, amount, program, levelNum, fromUser, reason, session) => {
    await db.collection('admin_earnings').insertOne({
        amount,
        program,
        level: levelNum,
        fromUser,
        reason,
        timestamp: new Date()
    }, { session });
    console.log(`Admin credited ${amount} for: ${reason}`);
};

const process3pPayment = async (db, session, buyerId, recipient, levelConfig, levelIndex) => {
    const program = '3p';
    const boxField = `packages.${program}.levels.${levelIndex}.boxes`;
    await db.collection('users').updateOne({ _id: recipient._id }, { $push: { [boxField]: buyerId } }, { session });
    const updatedRecipient = await db.collection('users').findOne({ _id: recipient._id }, { session });
    const boxCount = updatedRecipient.packages[program].levels[levelIndex].boxes.length;
    if (boxCount <= 2) {
        await db.collection('users').updateOne({ _id: recipient._id }, { $inc: { balance: levelConfig.cost } }, { session });
        console.log(`Payment for 3p box ${boxCount} sent to ${recipient.email}. Chain stops.`);
    } else {
        console.log(`Processing 3p box 3 for ${recipient.email}. Recycling and passing up action.`);
        const uplineForPayment = await findEligibleUpline(db, recipient._id, program, levelConfig.level, session);
        const circleField = `packages.${program}.levels.${levelIndex}.currentCircle`;
        const statusField = `packages.${program}.levels.${levelIndex}.status`;
        if (updatedRecipient.packages[program].levels[levelIndex].currentCircle >= 1) {
            await db.collection('users').updateOne({ _id: recipient._id }, { $set: { [boxField]: [], [statusField]: 'frozen' }, $inc: { [circleField]: 1 } }, { session });
        } else {
            await db.collection('users').updateOne({ _id: recipient._id }, { $set: { [boxField]: [] }, $inc: { [circleField]: 1 } }, { session });
        }
        if (uplineForPayment) {
            console.log(`Action passed up from ${recipient.email} to ${uplineForPayment.email}`);
            await process3pPayment(db, session, buyerId, uplineForPayment, levelConfig, levelIndex);
        } else {
            await creditAdmin(db, levelConfig.cost, program, levelConfig.level, buyerId, `3p box 3 pass-up, no upline for ${recipient.email}`, session);
            console.log(`Chain stopped. No eligible upline found for ${recipient.email}. Admin credited.`);
        }
    }
};

const process6pPayment = async (db, session, buyerId, recipient, levelConfig, levelIndex) => {
    const program = '6p';
    const boxField = `packages.${program}.levels.${levelIndex}.boxes`;

    // Step 1: Add the buyer's ID to the current recipient's box
    await db.collection('users').updateOne({ _id: recipient._id }, { $push: { [boxField]: buyerId } }, { session });

    const updatedRecipient = await db.collection('users').findOne({ _id: recipient._id }, { session });
    const boxCount = updatedRecipient.packages[program].levels[levelIndex].boxes.length;
    
    // Step 2: Handle payment/action based on box number
    switch (boxCount) {
        case 1:
        case 6:
            // Pass-up ACTION slots. This will fill a box in the upline's matrix.
            console.log(`Processing 6p box ${boxCount} for ${recipient.email}. Passing up action.`);
            const uplineForPayment = await findEligibleUpline(db, recipient._id, program, levelConfig.level, session);
            if (uplineForPayment) {
                console.log(`Action passed up from ${recipient.email} to ${uplineForPayment.email}`);
                // RECURSIVE CALL: The action now fills a box for the upline
                await process6pPayment(db, session, buyerId, uplineForPayment, levelConfig, levelIndex);
            } else {
                // If there's no upline, the money for this action goes to the admin.
                await creditAdmin(db, levelConfig.cost, program, levelConfig.level, buyerId, `6p box ${boxCount}, no upline for ${recipient.email}`, session);
                console.log(`Chain stopped. No eligible upline for ${recipient.email}. Admin credited.`);
            }
            break;
        
        case 2:
            // Spillover/Gift to downline slot
            const downlines = await db.collection('users').find({ referredBy: recipient._id }).toArray();
            if (downlines.length > 0) {
                const randomDownline = downlines[Math.floor(Math.random() * downlines.length)];
                await db.collection('users').updateOne({ _id: randomDownline._id }, { $inc: { balance: levelConfig.cost } }, { session });
            } else {
                await db.collection('users').updateOne({ _id: recipient._id }, { $inc: { balance: levelConfig.cost } }, { session });
            }
            break;
        
        case 3:
        case 4:
        case 5:
            // Direct payment slots to the matrix owner
            await db.collection('users').updateOne({ _id: recipient._id }, { $inc: { balance: levelConfig.cost } }, { session });
            break;
    }

    // Step 3: Check for recycle condition after payment is handled
    if (boxCount >= 6) {
        console.log(`Recycling 6p matrix for ${recipient.email}.`);
        const circleField = `packages.${program}.levels.${levelIndex}.currentCircle`;
        const statusField = `packages.${program}.levels.${levelIndex}.status`;

        if (updatedRecipient.packages[program].levels[levelIndex].currentCircle >= 1) {
            await db.collection('users').updateOne({ _id: recipient._id }, { $set: { [boxField]: [], [statusField]: 'frozen' }, $inc: { [circleField]: 1 } }, { session });
        } else {
            await db.collection('users').updateOne({ _id: recipient._id }, { $set: { [boxField]: [] }, $inc: { [circleField]: 1 } }, { session });
        }
    }
};

exports.purchasePackageLevel = async (req, res) => {
    const { program, level } = req.params;
    if (!['3p', '6p'].includes(program)) {
        return res.status(400).json({ msg: 'Invalid program specified.' });
    }
    const userId = new ObjectId(req.user.id);
    const db = getDB();
    const client = getClient();
    const session = client.startSession();

    try {
        let finalMessage = "";

        await session.withTransaction(async () => {
            const levelNum = parseInt(level);
            const [buyer, programConfig] = await Promise.all([
                db.collection('users').findOne({ _id: userId }, { session }),
                db.collection('programs').findOne({ name: program }, { session })
            ]);

            if (!buyer) throw new Error('User not found');
            if (!programConfig) throw new Error('Program configuration not found.');
            const levelConfig = programConfig.levels.find(l => l.level === levelNum);
            if (!levelConfig) throw new Error('Level configuration not found.');

            const levelIndex = levelNum - 1;
            const userPackageLevel = buyer.packages[program].levels[levelIndex];

            if (buyer.balance < levelConfig.cost) throw new Error('Insufficient balance');
            if (userPackageLevel.status !== 'locked') throw new Error(`This level is already ${userPackageLevel.status}.`);
            if (levelIndex > 0 && buyer.packages[program].levels[levelIndex - 1].status === 'locked') {
                throw new Error(`Please purchase Level ${levelNum - 1} before purchasing Level ${levelNum}.`);
            }

            await db.collection('users').updateOne({ _id: userId }, { $inc: { balance: -levelConfig.cost } }, { session });
            const statusUpdateField = `packages.${program}.levels.${levelIndex}.status`;
            await db.collection('users').updateOne({ _id: userId }, { $set: { [statusUpdateField]: 'active' } }, { session });
            finalMessage = `Level ${levelNum} of ${program} purchased successfully!`;

            if (!buyer.referredBy) {
                await creditAdmin(db, levelConfig.cost, program, levelNum, buyer._id, "User has no referrer", session);
                finalMessage += " No referrer found, funds sent to admin.";
                return;
            }

            const directReferrer = await db.collection('users').findOne({ _id: new ObjectId(buyer.referredBy) }, { session });
            if (!directReferrer) {
                await creditAdmin(db, levelConfig.cost, program, levelNum, buyer._id, "Referrer ID exists but user not found", session);
                finalMessage += " Referrer not found, funds sent to admin.";
                return;
            }

            let effectiveReferrer;
            const directReferrerLevel = directReferrer.packages[program].levels[levelIndex];
            if (directReferrerLevel.status !== 'locked') {
                effectiveReferrer = directReferrer;
            } else {
                effectiveReferrer = await findEligibleUpline(db, directReferrer._id, program, levelNum, session);
                finalMessage += ` Your direct referrer did not own this level, commission passed up.`;
            }

            if (!effectiveReferrer) {
                await creditAdmin(db, levelConfig.cost, program, levelNum, buyer._id, "No eligible upline found in chain", session);
                finalMessage += " No eligible upline found, funds sent to admin.";
                return;
            }
            
            // The main purchase function is now clean and delegates to the appropriate helper
            if (program === '3p') {
                await process3pPayment(db, session, buyer._id, effectiveReferrer, levelConfig, levelIndex);
            } else if (program === '6p') {
                await process6pPayment(db, session, buyer._id, effectiveReferrer, levelConfig, levelIndex);
            }
        });
        res.json({ msg: finalMessage });
    } catch (err) {
        console.error("Purchase Error:", err);
        res.status(500).json({ msg: err.message || 'Server error during purchase.' });
    } finally {
        await session.endSession();
    }
};

// ... a lot of code remains the same ...

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

exports.submitWithdraw = async (req, res) => {
    const { accountType, accountNumber, amount } = req.body;
    const db = getDB();
    const userId = new ObjectId(req.user.id);
    const requestedAmount = parseFloat(amount);

    try {
        const user = await db.collection('users').findOne({ _id: userId });

        // --- CRITICAL VALIDATION LOGIC START ---
        
        // 1. Calculate the sum of all existing pending withdrawals
        const pendingWithdrawalsResult = await db.collection('withdrawals').aggregate([
            { $match: { userId: userId, status: 'pending' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).toArray();
        
        const totalPending = pendingWithdrawalsResult.length > 0 ? pendingWithdrawalsResult[0].total : 0;

        // 2. Calculate the true available balance
        const availableBalance = user.balance - totalPending;

        // 3. Validate the new request against the available balance
        if (requestedAmount > availableBalance) {
            return res.status(400).json({ msg: `Withdrawal request of $${requestedAmount.toFixed(2)} exceeds your available balance of $${availableBalance.toFixed(2)}.` });
        }
        
        // --- CRITICAL VALIDATION LOGIC END ---

        const newWithdrawal = {
            userId: user._id,
            userEmail: user.email,
            accountType,
            accountNumber,
            amount: requestedAmount,
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

exports.unfreezeLevel = async (req, res) => {
    const { program, level } = req.params;
    const userId = new ObjectId(req.user.id);
    const db = getDB();
    const client = getClient();
    const session = client.startSession();

    try {
        await session.withTransaction(async () => {
            const levelNum = parseInt(level);
            const [user, programConfig] = await Promise.all([
                db.collection('users').findOne({ _id: userId }, { session }),
                db.collection('programs').findOne({ name: program }, { session })
            ]);

            if (!user) throw new Error('User not found');
            if (!programConfig) throw new Error('Program configuration not found.');
            const levelConfig = programConfig.levels.find(l => l.level === levelNum);
            if (!levelConfig || typeof levelConfig.unfreezeCost === 'undefined') {
                throw new Error('Level unfreeze configuration not found.');
            }

            const levelIndex = levelNum - 1;
            const userLevel = user.packages[program].levels[levelIndex];

            if (userLevel.status !== 'frozen') throw new Error('This level is not frozen.');
            if (user.balance < levelConfig.unfreezeCost) throw new Error('Insufficient balance to unfreeze.');

            await db.collection('users').updateOne({ _id: userId }, { $inc: { balance: -levelConfig.unfreezeCost } }, { session });
            const updates = {
                $set: {
                    [`packages.${program}.levels.${levelIndex}.status`]: 'active',
                    [`packages.${program}.levels.${levelIndex}.boxes`]: [],
                    [`packages.${program}.levels.${levelIndex}.currentCircle`]: 0
                }
            };
            await db.collection('users').updateOne({ _id: userId }, updates, { session });
            const eligibleRecipient = await findEligibleUpline(db, userId, program, levelNum, session);

            if (eligibleRecipient) {
                await db.collection('users').updateOne({ _id: eligibleRecipient._id }, { $inc: { balance: levelConfig.unfreezeCost } }, { session });
            } else {
                await creditAdmin(db, levelConfig.unfreezeCost, program, levelNum, userId, "Unfreeze fee, no eligible upline", session);
            }
        });
        res.json({ msg: `Level ${level} of ${program} has been unfrozen successfully!` });
    } catch (err) {
        console.error("Unfreeze Error:", err.message);
        res.status(500).json({ msg: err.message || 'Server Error during unfreeze.' });
    } finally {
        await session.endSession();
    }
};

exports.searchUsers = async (req, res) => {
    const db = getDB();
    const searchTerm = req.query.search || "";

    if (!searchTerm) {
        return res.json([]);
    }
    try {
        const users = await db.collection('users').find({
            $or: [
                { name: { $regex: searchTerm, $options: 'i' } },
                { email: { $regex: searchTerm, $options: 'i' } }
            ]
        }, {
            projection: { name: 1, email: 1 }
        }).limit(10).toArray();
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

exports.sendGift = async (req, res) => {
    const { recipientEmail, amount } = req.body;
    const senderId = new ObjectId(req.user.id);
    const client = getClient();
    const giftAmount = parseFloat(amount);

    if (isNaN(giftAmount) || giftAmount <= 0) {
        return res.status(400).json({ msg: 'Invalid amount provided.' });
    }
    const session = client.startSession();
    try {
        await session.withTransaction(async () => {
            const db = getDB();
            const sender = await db.collection('users').findOne({ _id: senderId }, { session });
            const recipient = await db.collection('users').findOne({ email: recipientEmail }, { session });
            if (!recipient) throw new Error('Recipient not found.');
            if (sender.email === recipient.email) throw new Error('You cannot send a gift to yourself.');
            if (sender.balance < giftAmount) throw new Error('Insufficient balance.');
            await db.collection('users').updateOne({ _id: senderId }, { $inc: { balance: -giftAmount } }, { session });
            await db.collection('users').updateOne({ _id: recipient._id }, { $inc: { balance: giftAmount } }, { session });
            await db.collection('gift_transactions').insertOne({
                senderId: senderId,
                recipientId: recipient._id,
                amount: giftAmount,
                timestamp: new Date()
            }, { session });
        });
        res.json({ msg: `Successfully sent $${giftAmount.toFixed(2)} to ${recipientEmail}.` });
    } catch (err) {
        console.error(err.message);
        if (err.message === 'Recipient not found.') {
            return res.status(404).json({ msg: err.message });
        }
        if (err.message === 'Insufficient balance.' || err.message === 'You cannot send a gift to yourself.') {
            return res.status(400).json({ msg: err.message });
        }
        res.status(500).send('Server Error');
    } finally {
        await session.endSession();
    }
};


exports.getUserDetailsById = async (req, res) => {
    const { id } = req.params;
    const db = getDB();

    // 1. Validate the ID format to prevent server errors
    if (!ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'Invalid user ID format.' });
    }

    try {
        // 2. Find the user by their _id
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(id) },
            // 3. IMPORTANT: Use projection to only return safe, public data
            {
                projection: {
                    name: 1,
                    myReferralId: 1,
                    _id: 0 // Exclude the database ID from the response
                }
            }
        );

        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        res.json(user);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
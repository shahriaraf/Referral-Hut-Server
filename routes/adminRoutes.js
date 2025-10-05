const express = require('express');
const router = express.Router();
const { getDeposits, getWithdrawalStats, handleDeposit, getWithdrawals, handleWithdrawal, getLevelsByProgram, deleteUser, updateLevelPrice, getAllPrograms, getAllUsers, sendGiftToUser } = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

router.get('/deposits', [authMiddleware, adminMiddleware], getDeposits);
router.put('/deposits/:id', [authMiddleware, adminMiddleware], handleDeposit);
router.get('/withdrawals', [authMiddleware, adminMiddleware], getWithdrawals);
router.put('/withdrawals/:id', [authMiddleware, adminMiddleware], handleWithdrawal);
router.get('/withdrawals/stats', [authMiddleware, adminMiddleware], getWithdrawalStats);

router.get('/programs/:programKey/levels', getLevelsByProgram);
router.patch('/programs/:programKey/levels/:levelNumber', [authMiddleware, adminMiddleware], updateLevelPrice);
router.get('/programs', authMiddleware, getAllPrograms);

router.get('/users', [authMiddleware, adminMiddleware], getAllUsers);
router.post('/users/:id/gift', [authMiddleware, adminMiddleware], sendGiftToUser);
router.delete('/users/:id', [authMiddleware, adminMiddleware], deleteUser);

module.exports = router;
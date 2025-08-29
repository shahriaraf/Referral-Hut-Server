const express = require('express');
const router = express.Router();
const { getDeposits, handleDeposit, getWithdrawals, handleWithdrawal } = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware'); // Add admin check later if needed

router.get('/deposits', authMiddleware, getDeposits);
router.put('/deposits/:id', authMiddleware, handleDeposit);
router.get('/withdrawals', authMiddleware, getWithdrawals);
router.put('/withdrawals/:id', authMiddleware, handleWithdrawal);

module.exports = router;
const express = require('express');
const router = express.Router();
const { getDeposits, handleDeposit, getWithdrawals, handleWithdrawal, getLevelsByProgram, updateLevelPrice,  } = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware'); // Add admin check later if needed

router.get('/deposits', authMiddleware, getDeposits);
router.put('/deposits/:id', authMiddleware, handleDeposit);
router.get('/withdrawals', authMiddleware, getWithdrawals);
router.put('/withdrawals/:id', authMiddleware, handleWithdrawal);
router.get('/programs/:programKey/levels',  (req, res, next) => {
    console.log('Route hit:', req.params.programKey);
    next();
}, getLevelsByProgram);
router.patch('/programs/:programKey/levels/:levelNumber', updateLevelPrice);

module.exports = router;
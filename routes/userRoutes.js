const express = require('express');
const router = express.Router();
const { submitDeposit, submitWithdraw, purchasePackageLevel } = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/deposit', authMiddleware, submitDeposit);
router.post('/withdraw', authMiddleware, submitWithdraw);
router.post('/packages/purchase/:program/:level', authMiddleware, purchasePackageLevel);

module.exports = router;
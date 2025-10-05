const express = require('express');
const router = express.Router();
const { submitDeposit, submitWithdraw, purchasePackageLevel, searchUsers, sendGift, unfreezeLevel, getUserDetailsById } = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/deposit', authMiddleware, submitDeposit);
router.post('/withdraw', authMiddleware, submitWithdraw);
router.post('/packages/purchase/:program/:level', authMiddleware, purchasePackageLevel);
router.post('/packages/unfreeze/:program/:level', authMiddleware, unfreezeLevel);
router.get('/search', authMiddleware, searchUsers);
router.post('/gift', authMiddleware, sendGift);
router.get('/details/:id', authMiddleware, getUserDetailsById);

module.exports = router;
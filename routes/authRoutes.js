const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getUser, getAdminReferralId } = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/', authMiddleware, getUser);
router.get('/admin-referral-id', getAdminReferralId);

module.exports = router;
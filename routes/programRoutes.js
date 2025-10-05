const express = require('express');
const router = express.Router();
const { getProgramLevels, updateLevelDetails } = require('../controllers/programController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

router.get('/:name/levels', getProgramLevels);
router.patch('/:name/levels/:level', [authMiddleware, adminMiddleware], updateLevelDetails);

module.exports = router;
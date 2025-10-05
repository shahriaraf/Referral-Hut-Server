const { getDB } = require('../config/db');

exports.getProgramLevels = async (req, res) => {
    const { name } = req.params;
    const db = getDB();
    try {
        const program = await db.collection('programs').findOne({ name });

        if (!program || !Array.isArray(program.levels)) {
            return res.status(404).json([]);
        }
        res.json(program.levels);
    } catch (err) {
        console.error(err.message);
        res.status(500).json([]);
    }
};

exports.updateLevelDetails = async (req, res) => {
    const { name, level } = req.params;
    const { cost, unfreezeCost } = req.body;
    const db = getDB();

    try {
        const updateFields = {};
        if (cost !== undefined && !isNaN(parseFloat(cost))) {
            updateFields['levels.$.cost'] = parseFloat(cost);
        }
        if (unfreezeCost !== undefined && !isNaN(parseFloat(unfreezeCost))) {
            updateFields['levels.$.unfreezeCost'] = parseFloat(unfreezeCost);
        }
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ msg: 'No valid update fields provided.' });
        }
        const result = await db.collection('programs').updateOne({ name: name, "levels.level": parseInt(level) }, { $set: updateFields });

        if (result.matchedCount === 0) {
            return res.status(404).json({ msg: `Level ${level} not found in program '${name}'` });
        }
        if (result.modifiedCount === 0) {
            return res.json({ msg: 'Level found, but no new data was provided to modify.' });
        }
        res.json({ msg: `Level ${level} in ${name} program updated successfully` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
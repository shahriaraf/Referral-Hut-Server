module.exports = function(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ msg: 'No user found, authorization denied' });
    }

    if (req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ msg: 'Access denied. Admin privileges required.' });
    }
};
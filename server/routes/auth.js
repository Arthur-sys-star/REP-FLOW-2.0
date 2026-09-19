const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const [rows] = await pool.query(
    'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1',
    [email.trim().toLowerCase()]
  );

  if (rows.length === 0) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const user = rows[0];

  if (!user.is_active) {
    return res.status(403).json({ message: 'This account has been deactivated. Contact an administrator.' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  });

  // Never send the password hash back to the frontend.
  res.json({ token, user: payload });
}));

// GET /api/auth/me — used by the frontend to validate a stored token on load
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1',
    [req.user.id]
  );
  if (rows.length === 0 || !rows[0].is_active) {
    return res.status(401).json({ message: 'Account no longer available.' });
  }
  res.json({ user: rows[0] });
}));

module.exports = router;

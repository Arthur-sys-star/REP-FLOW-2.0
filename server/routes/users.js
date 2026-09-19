const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();

router.use(verifyToken, requireRole('admin'));

// GET /api/users
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
}));

// POST /api/users
router.post('/', asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password and role are required.' });
  }
  if (!['admin', 'staff', 'technician'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name.trim(), email.trim().toLowerCase(), hash, role]
  );

  await logActivity(pool, { user: req.user, action: `Created ${role} user "${name}"`, entityType: 'user', entityId: result.insertId });
  res.status(201).json({ id: result.insertId, name, email, role, is_active: 1 });
}));

// PUT /api/users/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, email, role, is_active } = req.body;

  if (role && !['admin', 'staff', 'technician'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' });
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (existing.length === 0) {
    return res.status(404).json({ message: 'User not found.' });
  }

  await pool.query(
    `UPDATE users SET
       name = COALESCE(?, name),
       email = COALESCE(?, email),
       role = COALESCE(?, role),
       is_active = COALESCE(?, is_active)
     WHERE id = ?`,
    [name ? name.trim() : null, email ? email.trim().toLowerCase() : null, role || null,
     typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null, req.params.id]
  );

  if (typeof is_active === 'boolean') {
    await logActivity(pool, {
      user: req.user, action: `${is_active ? 'Activated' : 'Deactivated'} user #${req.params.id}`,
      entityType: 'user', entityId: Number(req.params.id)
    });
  }
  res.json({ message: 'User updated successfully.' });
}));

// PUT /api/users/:id/password — reset a user's password
router.put('/:id/password', asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }
  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({ message: 'Password updated successfully.' });
}));

// DELETE /api/users/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'You cannot delete your own account while logged in.' });
  }
  const [result] = await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({ message: 'User deleted successfully.' });
}));

module.exports = router;

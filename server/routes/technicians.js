const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

// GET /api/technicians — includes live assigned/open job counts and the
// linked login account's name/email (if any), so the admin UI can show
// who a technician profile is currently linked to.
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT t.*, u.name AS user_name, u.email AS user_email,
      (SELECT COUNT(*) FROM service_tickets st WHERE st.technician_id = t.id) AS total_jobs,
      (SELECT COUNT(*) FROM service_tickets st WHERE st.technician_id = t.id
        AND st.status NOT IN ('Delivered','Cancelled')) AS open_jobs
    FROM technicians t
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
  `);
  res.json(rows);
}));

// GET /api/technicians/unlinked-users — technician-role users not yet
// linked to a technician profile (for the admin's "link to login" picker).
// Must be declared before GET /:id or Express would treat this path as an id.
router.get('/unlinked-users', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT u.id, u.name, u.email FROM users u
    WHERE u.role = 'technician'
      AND u.id NOT IN (SELECT user_id FROM technicians WHERE user_id IS NOT NULL)
    ORDER BY u.name ASC
  `);
  res.json(rows);
}));

// GET /api/technicians/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM technicians WHERE id = ?', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Technician not found.' });

  const [tickets] = await pool.query(
    `SELECT id, ticket_number, device_type, brand, status, created_at
     FROM service_tickets WHERE technician_id = ? ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ technician: rows[0], tickets });
}));

// POST /api/technicians
router.post('/', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, phone, specialization, experience_years, status, user_id } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ message: 'Technician name and phone are required.' });
  }
  if (user_id) {
    const [userRows] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'technician'", [user_id]);
    if (userRows.length === 0) {
      return res.status(400).json({ message: 'Selected login account is not a technician-role user.' });
    }
    const [alreadyLinked] = await pool.query('SELECT id FROM technicians WHERE user_id = ?', [user_id]);
    if (alreadyLinked.length > 0) {
      return res.status(400).json({ message: 'That login is already linked to another technician profile.' });
    }
  }
  const [result] = await pool.query(
    `INSERT INTO technicians (user_id, name, phone, specialization, experience_years, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user_id || null, name.trim(), phone.trim(), specialization || null, experience_years || 0, status || 'Active']
  );
  const [row] = await pool.query('SELECT * FROM technicians WHERE id = ?', [result.insertId]);
  res.status(201).json(row[0]);
}));

// PUT /api/technicians/:id
router.put('/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, phone, specialization, experience_years, status, user_id } = req.body;
  const [existing] = await pool.query('SELECT id, status, user_id FROM technicians WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Technician not found.' });

  let nextUserId = existing[0].user_id;
  if (user_id !== undefined) {
    if (user_id === null || user_id === '') {
      nextUserId = null; // explicit unlink
    } else {
      const [userRows] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'technician'", [user_id]);
      if (userRows.length === 0) {
        return res.status(400).json({ message: 'Selected login account is not a technician-role user.' });
      }
      const [alreadyLinked] = await pool.query('SELECT id FROM technicians WHERE user_id = ? AND id != ?', [user_id, req.params.id]);
      if (alreadyLinked.length > 0) {
        return res.status(400).json({ message: 'That login is already linked to another technician profile.' });
      }
      nextUserId = user_id;
    }
  }

  await pool.query(
    `UPDATE technicians SET
       user_id = ?, name = COALESCE(?, name), phone = COALESCE(?, phone),
       specialization = ?, experience_years = COALESCE(?, experience_years),
       status = COALESCE(?, status)
     WHERE id = ?`,
    [nextUserId, name || null, phone || null, specialization || null, experience_years, status || null, req.params.id]
  );
  if (status && status !== existing[0].status) {
    await logActivity(pool, {
      user: req.user, action: `${status === 'Inactive' ? 'Deactivated' : 'Activated'} technician "${name || ''}"`.trim(),
      entityType: 'technician', entityId: Number(req.params.id)
    });
  }
  const [row] = await pool.query('SELECT * FROM technicians WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// DELETE /api/technicians/:id — admin only
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM technicians WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ message: 'Technician not found.' });
  res.json({ message: 'Technician deleted successfully.' });
}));

module.exports = router;

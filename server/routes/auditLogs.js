const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);
router.use(requireRole('admin'));

// GET /api/audit-logs?limit=50
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [rows] = await pool.query(
    'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]
  );
  res.json(rows);
}));

module.exports = router;

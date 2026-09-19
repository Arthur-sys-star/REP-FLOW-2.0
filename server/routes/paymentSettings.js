const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');
const { makeUploader, relativePath } = require('../utils/upload');

const router = express.Router();
router.use(verifyToken);

const qrUpload = makeUploader('payment-qr');

// GET /api/payment-settings — every logged-in role can view (staff need
// this to show customers how to pay); only Admin can change it.
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM payment_settings WHERE id = 1');
  res.json(rows[0] || null);
}));

// PUT /api/payment-settings — admin only
router.put('/', requireRole('admin'), asyncHandler(async (req, res) => {
  const {
    business_name, upi_id, bank_name, account_holder, account_number, ifsc, branch, instructions
  } = req.body;

  await pool.query(
    `UPDATE payment_settings SET
       business_name = ?, upi_id = ?, bank_name = ?, account_holder = ?,
       account_number = ?, ifsc = ?, branch = ?, instructions = ?, updated_by = ?
     WHERE id = 1`,
    [business_name || null, upi_id || null, bank_name || null, account_holder || null,
     account_number || null, ifsc || null, branch || null, instructions || null, req.user.id]
  );

  await logActivity(pool, { user: req.user, action: 'Updated payment settings', entityType: 'payment_settings', entityId: 1 });
  const [rows] = await pool.query('SELECT * FROM payment_settings WHERE id = 1');
  res.json(rows[0]);
}));

// POST /api/payment-settings/qr — admin uploads the UPI QR image
router.post('/qr', requireRole('admin'), qrUpload.single('qr'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image file received.' });
  const filePath = relativePath('payment-qr', req.file.filename);
  await pool.query('UPDATE payment_settings SET upi_qr_path = ?, updated_by = ? WHERE id = 1', [filePath, req.user.id]);
  await logActivity(pool, { user: req.user, action: 'Updated UPI QR code', entityType: 'payment_settings', entityId: 1 });
  const [rows] = await pool.query('SELECT * FROM payment_settings WHERE id = 1');
  res.json(rows[0]);
}));

module.exports = router;

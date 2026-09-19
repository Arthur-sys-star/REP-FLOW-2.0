const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

const METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Card'];

// GET /api/payments?invoiceId= — list payments for one invoice
router.get('/', asyncHandler(async (req, res) => {
  const { invoiceId } = req.query;
  if (!invoiceId) return res.status(400).json({ message: 'invoiceId is required.' });
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS received_by_name FROM payments p
     LEFT JOIN users u ON u.id = p.received_by
     WHERE p.invoice_id = ? ORDER BY p.received_at ASC`,
    [invoiceId]
  );
  res.json(rows);
}));

// POST /api/payments — record a payment against an invoice
// (Cash / UPI / Bank Transfer recorded manually; Card recorded as a method
// only — never a card number, CVV or PIN, per spec section 19.5/40.)
router.post('/', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { invoice_id, amount, method, reference_number } = req.body;
  const amt = Number(amount);

  if (!invoice_id || !amt || amt <= 0) {
    return res.status(400).json({ message: 'An invoice and a payment amount greater than zero are required.' });
  }
  if (!METHODS.includes(method)) {
    return res.status(400).json({ message: `Payment method must be one of: ${METHODS.join(', ')}` });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [invoiceRows] = await conn.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [invoice_id]);
    if (invoiceRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Invoice not found.' });
    }
    const invoice = invoiceRows[0];

    const [[{ paidSoFar }]] = await conn.query(
      'SELECT COALESCE(SUM(amount), 0) AS paidSoFar FROM payments WHERE invoice_id = ?', [invoice_id]
    );
    const remainingBalance = Number(invoice.total_amount) - Number(paidSoFar);

    if (amt > remainingBalance + 0.01) { // small epsilon for decimal rounding
      await conn.rollback();
      return res.status(400).json({
        message: `Payment of ${amt} exceeds the remaining balance of ${remainingBalance.toFixed(2)}.`
      });
    }

    const [result] = await conn.query(
      `INSERT INTO payments (invoice_id, amount, method, reference_number, received_by)
       VALUES (?, ?, ?, ?, ?)`,
      [invoice_id, amt, method, reference_number || null, req.user.id]
    );

    const newPaidTotal = Number(paidSoFar) + amt;
    const newStatus = newPaidTotal >= Number(invoice.total_amount) - 0.01 ? 'Paid'
      : newPaidTotal > 0 ? 'Partial' : 'Pending';

    await conn.query('UPDATE invoices SET payment_status = ? WHERE id = ?', [newStatus, invoice_id]);
    await conn.query('UPDATE service_tickets SET payment_status = ? WHERE id = ?', [newStatus, invoice.ticket_id]);

    await conn.commit();
    await logActivity(pool, {
      user: req.user, action: `Recorded ${method} payment of ${amt}`,
      entityType: 'invoice', entityId: Number(invoice_id), details: reference_number ? `Ref: ${reference_number}` : null
    });

    const [row] = await pool.query('SELECT * FROM payments WHERE id = ?', [result.insertId]);
    res.status(201).json({ payment: row[0], payment_status: newStatus, balance: Number(invoice.total_amount) - newPaidTotal });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;

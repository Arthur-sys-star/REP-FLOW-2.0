const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

const CHECKLIST_FIELDS = [
  'device_tested', 'repair_verified', 'accessories_returned',
  'customer_verified', 'condition_confirmed', 'payment_completed', 'customer_received'
];

// GET /api/tickets/:ticketId/handover — current checklist state (creates a
// blank one on first view so the frontend always has something to render).
router.get('/:ticketId/handover', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM handover_records WHERE ticket_id = ?', [req.params.ticketId]);
  if (rows.length > 0) return res.json(rows[0]);
  res.json({
    ticket_id: Number(req.params.ticketId),
    device_tested: 0, repair_verified: 0, accessories_returned: 0,
    customer_verified: 0, condition_confirmed: 0, payment_completed: 0, customer_received: 0,
    confirmed_at: null
  });
}));

// PUT /api/tickets/:ticketId/handover — save checklist progress (not yet confirmed)
router.put('/:ticketId/handover', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [ticketRows] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.ticketId]);
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  if (ticketRows[0].status !== 'Ready for Delivery') {
    return res.status(400).json({ message: 'Handover can only be prepared for a ticket that is Ready for delivery.' });
  }

  const values = CHECKLIST_FIELDS.map(f => (req.body[f] ? 1 : 0));
  await pool.query(
    `INSERT INTO handover_records (ticket_id, ${CHECKLIST_FIELDS.join(', ')})
     VALUES (?, ${CHECKLIST_FIELDS.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${CHECKLIST_FIELDS.map(f => `${f} = VALUES(${f})`).join(', ')}`,
    [req.params.ticketId, ...values]
  );
  const [row] = await pool.query('SELECT * FROM handover_records WHERE ticket_id = ?', [req.params.ticketId]);
  res.json(row[0]);
}));

// POST /api/tickets/:ticketId/handover/confirm — the ONLY way a ticket
// becomes Delivered. Requires every checklist item to be true.
router.post('/:ticketId/handover/confirm', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [ticketRows] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.ticketId]);
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  const ticket = ticketRows[0];
  if (ticket.status !== 'Ready for Delivery') {
    return res.status(400).json({ message: 'Only a ticket that is Ready for delivery can be handed over.' });
  }

  const [handoverRows] = await pool.query('SELECT * FROM handover_records WHERE ticket_id = ?', [req.params.ticketId]);
  const record = handoverRows[0];
  const allChecked = record && CHECKLIST_FIELDS.every(f => !!record[f]);
  if (!allChecked) {
    return res.status(400).json({ message: 'Every handover checklist item must be confirmed first.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE handover_records SET confirmed_by = ?, confirmed_at = NOW() WHERE ticket_id = ?',
      [req.user.id, req.params.ticketId]);
    await conn.query('UPDATE service_tickets SET status = ? WHERE id = ?', ['Delivered', req.params.ticketId]);
    await conn.query(
      'INSERT INTO ticket_status_history (ticket_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.ticketId, 'Delivered', 'Handover checklist confirmed', req.user.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await logActivity(pool, {
    user: req.user, action: `Confirmed handover — ticket ${ticket.ticket_number} delivered`,
    entityType: 'ticket', entityId: Number(req.params.ticketId)
  });

  const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.ticketId]);
  res.json(row[0]);
}));

module.exports = router;

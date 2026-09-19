const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { nextCode } = require('../utils/idGenerator');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

// GET /api/billing — list invoices
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT i.*, t.ticket_number, t.device_type, t.brand, c.name AS customer_name
    FROM invoices i
    JOIN service_tickets t ON t.id = i.ticket_id
    JOIN customers c ON c.id = t.customer_id
    ORDER BY i.created_at DESC
  `);
  res.json(rows);
}));

// GET /api/billing/:id — printable invoice detail, including payments and balance
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT i.*, t.ticket_number, t.device_type, t.brand, t.model, t.serial_number,
           c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address
    FROM invoices i
    JOIN service_tickets t ON t.id = i.ticket_id
    JOIN customers c ON c.id = t.customer_id
    WHERE i.id = ?
  `, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found.' });
  const invoice = rows[0];

  const [parts] = await pool.query(
    `SELECT tp.quantity, tp.unit_cost_at_use, p.name AS part_name
     FROM ticket_parts tp JOIN parts p ON p.id = tp.part_id
     WHERE tp.ticket_id = (SELECT ticket_id FROM invoices WHERE id = ?)`,
    [req.params.id]
  );

  const [payments] = await pool.query(
    `SELECT pay.*, u.name AS received_by_name FROM payments pay
     LEFT JOIN users u ON u.id = pay.received_by
     WHERE pay.invoice_id = ? ORDER BY pay.received_at ASC`,
    [req.params.id]
  );
  const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  res.json({
    invoice: { ...invoice, paid_amount: paidAmount, balance: Number(invoice.total_amount) - paidAmount },
    parts,
    payments
  });
}));

// POST /api/billing/generate — build (or refresh) an invoice from a ticket's current charges
// Enforces "one ticket = one invoice" at the application layer; the
// database's UNIQUE constraint on invoices.ticket_id is the second,
// unconditional layer of that same rule.
router.post('/generate', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { ticket_id } = req.body;
  if (!ticket_id) return res.status(400).json({ message: 'ticket_id is required.' });

  const [ticketRows] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [ticket_id]);
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  const ticket = ticketRows[0];
  if (ticket.is_draft) {
    return res.status(400).json({ message: 'Cannot invoice a draft ticket — submit it first.' });
  }

  const [partsSumRows] = await pool.query(
    'SELECT COALESCE(SUM(quantity * unit_cost_at_use), 0) AS parts_cost FROM ticket_parts WHERE ticket_id = ?',
    [ticket_id]
  );
  const partsCost = Number(partsSumRows[0].parts_cost);
  const total = Number(ticket.service_charge) + partsCost + Number(ticket.other_charges) - Number(ticket.discount);

  const [existingInvoice] = await pool.query('SELECT * FROM invoices WHERE ticket_id = ?', [ticket_id]);

  if (existingInvoice.length > 0) {
    // Never create a second invoice — refresh the existing one instead.
    await pool.query(
      `UPDATE invoices SET service_charge = ?, parts_cost = ?, other_charges = ?, discount = ?, total_amount = ?
        WHERE ticket_id = ?`,
      [ticket.service_charge, partsCost, ticket.other_charges, ticket.discount, total, ticket_id]
    );
    const [row] = await pool.query('SELECT * FROM invoices WHERE ticket_id = ?', [ticket_id]);
    return res.json({ ...row[0], already_existed: true });
  }

  const invoiceNumber = await nextCode(pool, 'invoices', 'INV', 'invoice_number');
  const [result] = await pool.query(
    `INSERT INTO invoices (invoice_number, ticket_id, service_charge, parts_cost, other_charges, discount, total_amount, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [invoiceNumber, ticket_id, ticket.service_charge, partsCost, ticket.other_charges, ticket.discount, total, ticket.payment_status]
  );
  await logActivity(pool, {
    user: req.user, action: `Generated invoice ${invoiceNumber}`, entityType: 'invoice', entityId: result.insertId,
    details: `Ticket ${ticket.ticket_number}`
  });
  const [row] = await pool.query('SELECT * FROM invoices WHERE id = ?', [result.insertId]);
  res.status(201).json({ ...row[0], already_existed: false });
}));

module.exports = router;

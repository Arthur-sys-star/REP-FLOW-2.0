const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

// GET /api/customers?search=
router.get('/', asyncHandler(async (req, res) => {
  const search = (req.query.search || '').trim();
  let rows;
  if (search) {
    const like = `%${search}%`;
    [rows] = await pool.query(
      `SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?
       ORDER BY created_at DESC`,
      [like, like, like]
    );
  } else {
    [rows] = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
  }
  res.json(rows);
}));

// GET /api/customers/:id — profile, summary, service history, invoices, devices
router.get('/:id', asyncHandler(async (req, res) => {
  const [customerRows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (customerRows.length === 0) {
    return res.status(404).json({ message: 'Customer not found.' });
  }

  const [tickets] = await pool.query(
    `SELECT t.id, t.ticket_number, t.device_type, t.brand, t.model, t.status,
            t.payment_status, t.created_at, tech.name AS technician_name,
            i.id AS invoice_id, i.invoice_number, i.total_amount
     FROM service_tickets t
     LEFT JOIN technicians tech ON tech.id = t.technician_id
     LEFT JOIN invoices i ON i.ticket_id = t.id
     WHERE t.customer_id = ? AND t.is_draft = 0
     ORDER BY t.created_at DESC`,
    [req.params.id]
  );

  const summary = {
    total_tickets: tickets.length,
    active_repairs: tickets.filter(t => !['Delivered', 'Cancelled'].includes(t.status)).length,
    completed_repairs: tickets.filter(t => t.status === 'Delivered').length,
    unpaid_invoices: tickets.filter(t => t.invoice_id && t.payment_status !== 'Paid').length,
    total_spent: tickets.filter(t => t.payment_status === 'Paid')
      .reduce((sum, t) => sum + Number(t.total_amount || 0), 0)
  };

  // Group repeated repairs by device (brand + model) — section 13 of the spec.
  const devices = {};
  tickets.forEach(t => {
    const key = `${t.brand} ${t.model || ''}`.trim();
    if (!devices[key]) devices[key] = [];
    devices[key].push(t.ticket_number);
  });

  res.json({
    customer: customerRows[0],
    summary,
    history: tickets,
    devices: Object.entries(devices).map(([device, ticketNumbers]) => ({ device, ticketNumbers }))
  });
}));

// POST /api/customers
router.post('/', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ message: 'Customer name and phone are required.' });
  }
  const [result] = await pool.query(
    'INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)',
    [name.trim(), phone.trim(), email ? email.trim() : null, address ? address.trim() : null]
  );
  await logActivity(pool, { user: req.user, action: `Added customer "${name}"`, entityType: 'customer', entityId: result.insertId });
  const [row] = await pool.query('SELECT * FROM customers WHERE id = ?', [result.insertId]);
  res.status(201).json(row[0]);
}));

// PUT /api/customers/:id
router.put('/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  const [existing] = await pool.query('SELECT id FROM customers WHERE id = ?', [req.params.id]);
  if (existing.length === 0) {
    return res.status(404).json({ message: 'Customer not found.' });
  }
  await pool.query(
    `UPDATE customers SET
       name = COALESCE(?, name), phone = COALESCE(?, phone),
       email = ?, address = ?
     WHERE id = ?`,
    [name || null, phone || null, email || null, address || null, req.params.id]
  );
  const [row] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// DELETE /api/customers/:id — admin only
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Customer not found.' });
  }
  await logActivity(pool, { user: req.user, action: `Deleted customer #${req.params.id}`, entityType: 'customer', entityId: Number(req.params.id) });
  res.json({ message: 'Customer deleted successfully.' });
}));

module.exports = router;

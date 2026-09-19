const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /api/search?q=
router.get('/', asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ customers: [], tickets: [], invoices: [], parts: [], technicians: [] });
  const like = `%${q}%`;
  const isTechnician = req.user.role === 'technician';

  const [customers] = isTechnician ? [[]] : await pool.query(
    'SELECT id, name, phone, email FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? LIMIT 5',
    [like, like, like]
  );

  const technicianScope = isTechnician
    ? 'AND t.technician_id = (SELECT id FROM technicians WHERE user_id = ?)'
    : '';
  const ticketParams = isTechnician ? [like, like, like, like, req.user.id] : [like, like, like, like];
  const [tickets] = await pool.query(
    `SELECT t.id, t.ticket_number, t.brand, t.device_type, t.status, c.name AS customer_name
     FROM service_tickets t JOIN customers c ON c.id = t.customer_id
     WHERE (t.ticket_number LIKE ? OR c.phone LIKE ? OR t.brand LIKE ? OR t.model LIKE ?) AND t.is_draft = 0 ${technicianScope}
     LIMIT 5`,
    ticketParams
  );

  const [invoices] = isTechnician ? [[]] : await pool.query(
    `SELECT i.id, i.invoice_number, i.total_amount, i.payment_status, t.ticket_number
     FROM invoices i JOIN service_tickets t ON t.id = i.ticket_id
     WHERE i.invoice_number LIKE ? LIMIT 5`,
    [like]
  );

  const [parts] = isTechnician ? [[]] : await pool.query(
    'SELECT id, name, sku, quantity FROM parts WHERE sku LIKE ? OR name LIKE ? LIMIT 5',
    [like, like]
  );

  const [technicians] = (req.user.role === 'admin') ? await pool.query(
    'SELECT id, name, specialization, status FROM technicians WHERE name LIKE ? LIMIT 5',
    [like]
  ) : [[]];

  res.json({ customers, tickets, invoices, parts, technicians });
}));

module.exports = router;

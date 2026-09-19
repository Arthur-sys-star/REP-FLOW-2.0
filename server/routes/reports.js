const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);
// Every report here includes financial and/or business-wide data — admin-only,
// enforced here rather than left to the frontend nav to hide.
router.use(requireRole('admin'));

// GET /api/reports
router.get('/', asyncHandler(async (req, res) => {
  const [[customerCounts]] = await pool.query(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS new_last_30d
    FROM customers
  `);

  const [[ticketCounts]] = await pool.query(`
    SELECT
      COUNT(*) AS total_tickets,
      SUM(CASE WHEN status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) AS open_tickets,
      SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered_tickets,
      SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_tickets,
      ROUND(AVG(CASE WHEN status = 'Delivered' THEN TIMESTAMPDIFF(HOUR, created_at, updated_at) END), 1) AS avg_repair_hours
    FROM service_tickets WHERE is_draft = 0
  `);

  const [[finance]] = await pool.query(`
    SELECT
      COALESCE(SUM(total_amount), 0) AS total_billed,
      COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) AS total_collected
    FROM invoices
  `);
  const [[{ total_paid_via_payments }]] = await pool.query(
    'SELECT COALESCE(SUM(amount), 0) AS total_paid_via_payments FROM payments'
  );
  const outstanding = Number(finance.total_billed) - Number(total_paid_via_payments);

  const [paymentMethods] = await pool.query(`
    SELECT method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM payments GROUP BY method
  `);

  const [statusDistribution] = await pool.query(
    "SELECT status, COUNT(*) AS count FROM service_tickets WHERE is_draft = 0 GROUP BY status"
  );

  const [technicianWorkload] = await pool.query(`
    SELECT t.id, t.name,
      COUNT(st.id) AS total_jobs,
      SUM(CASE WHEN st.status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) AS pending_jobs,
      SUM(CASE WHEN st.status = 'Delivered' THEN 1 ELSE 0 END) AS delivered_jobs
    FROM technicians t
    LEFT JOIN service_tickets st ON st.technician_id = t.id
    GROUP BY t.id, t.name
    ORDER BY total_jobs DESC
  `);

  const [monthlyBilling] = await pool.query(`
    SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
           COUNT(*) AS invoice_count,
           COALESCE(SUM(total_amount), 0) AS total_billed
    FROM invoices
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month DESC
    LIMIT 12
  `);

  const [[partCounts]] = await pool.query(`
    SELECT COUNT(*) AS total_parts,
      SUM(CASE WHEN quantity <= min_stock AND quantity > 0 THEN 1 ELSE 0 END) AS low_stock,
      SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) AS out_of_stock
    FROM parts
  `);

  const [stockMovement] = await pool.query(`
    SELECT type, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS total_units
    FROM inventory_transactions GROUP BY type
  `);

  res.json({
    total_customers: customerCounts.total,
    new_customers_30d: customerCounts.new_last_30d || 0,
    total_tickets: ticketCounts.total_tickets || 0,
    open_tickets: ticketCounts.open_tickets || 0,
    delivered_tickets: ticketCounts.delivered_tickets || 0,
    cancelled_tickets: ticketCounts.cancelled_tickets || 0,
    avg_repair_hours: ticketCounts.avg_repair_hours,
    total_billed: finance.total_billed,
    total_collected: finance.total_collected,
    outstanding: outstanding > 0 ? outstanding : 0,
    paymentMethods,
    statusDistribution,
    technicianWorkload,
    monthlyBilling,
    inventory: {
      total_parts: partCounts.total_parts || 0,
      low_stock: partCounts.low_stock || 0,
      out_of_stock: partCounts.out_of_stock || 0
    },
    stockMovement
  });
}));

module.exports = router;

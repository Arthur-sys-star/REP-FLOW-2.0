const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// Groupings used consistently across the admin/staff dashboards so the
// same ticket is never counted as "in progress" in one place and
// "open" in another.
const IN_PROGRESS_STATUSES = ['Inspection', 'Diagnosing', 'Waiting for Approval', 'Waiting for Parts', 'Repair In Progress', 'Testing'];
const AWAITING_HANDOVER_STATUSES = ['Repair Completed', 'Ready for Delivery'];

router.get('/', asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') return res.json(await adminDashboard());
  if (req.user.role === 'staff') return res.json(await staffDashboard());
  if (req.user.role === 'technician') return res.json(await technicianDashboard(req.user.id));
  return res.status(403).json({ message: 'Unknown role.' });
}));

// ==================================================================
// ADMIN — full business visibility: revenue, technician workload,
// shop-wide status distribution, recent activity across every ticket.
// ==================================================================
async function adminDashboard() {
  const [[counts]] = await pool.query(`
    SELECT
      COUNT(*) AS total_jobs,
      SUM(CASE WHEN status IN ('Received','Assigned') THEN 1 ELSE 0 END) AS open_jobs,
      SUM(CASE WHEN status IN (${IN_PROGRESS_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS in_progress_jobs,
      SUM(CASE WHEN status IN (${AWAITING_HANDOVER_STATUSES.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS ready_jobs,
      SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered_jobs,
      SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_jobs,
      SUM(CASE WHEN status NOT IN ('Delivered','Cancelled') AND payment_status != 'Paid' THEN 1 ELSE 0 END) AS pending_payments
    FROM service_tickets WHERE is_draft = 0
  `, [...IN_PROGRESS_STATUSES, ...AWAITING_HANDOVER_STATUSES]);

  const [[{ total_customers }]] = await pool.query('SELECT COUNT(*) AS total_customers FROM customers');

  const [[revenue]] = await pool.query(`
    SELECT COALESCE(SUM(total_amount), 0) AS paid_revenue
    FROM invoices WHERE payment_status = 'Paid'
  `);

  const [lowStock] = await pool.query(
    'SELECT id, name, sku, quantity, min_stock FROM parts WHERE quantity <= min_stock ORDER BY quantity ASC'
  );

  const [recentTickets] = await pool.query(`
    SELECT t.id, t.ticket_number, t.device_type, t.brand, t.status, t.payment_status, t.created_at,
           c.name AS customer_name
    FROM service_tickets t JOIN customers c ON c.id = t.customer_id
    WHERE t.is_draft = 0
    ORDER BY t.created_at DESC LIMIT 8
  `);

  const [statusDistribution] = await pool.query(
    'SELECT status, COUNT(*) AS count FROM service_tickets WHERE is_draft = 0 GROUP BY status'
  );

  const [technicianWorkload] = await pool.query(`
    SELECT tech.id, tech.name, tech.status,
           COUNT(t.id) AS total_assigned,
           SUM(CASE WHEN t.status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) AS active_jobs,
           SUM(CASE WHEN t.status = 'Delivered' THEN 1 ELSE 0 END) AS completed_jobs
    FROM technicians tech
    LEFT JOIN service_tickets t ON t.technician_id = tech.id AND t.is_draft = 0
    GROUP BY tech.id, tech.name, tech.status
    ORDER BY active_jobs DESC
  `);

  const [recentActivity] = await pool.query(`
    SELECT h.status, h.note, h.changed_at, t.ticket_number, u.name AS changed_by_name
    FROM ticket_status_history h
    JOIN service_tickets t ON t.id = h.ticket_id
    LEFT JOIN users u ON u.id = h.changed_by
    ORDER BY h.changed_at DESC LIMIT 10
  `);

  return {
    role: 'admin',
    totals: {
      total_jobs: counts.total_jobs || 0,
      open_jobs: counts.open_jobs || 0,
      in_progress_jobs: counts.in_progress_jobs || 0,
      ready_jobs: counts.ready_jobs || 0,
      delivered_jobs: counts.delivered_jobs || 0,
      cancelled_jobs: counts.cancelled_jobs || 0,
      pending_payments: counts.pending_payments || 0,
      total_customers,
      paid_revenue: revenue.paid_revenue || 0,
      low_stock_count: lowStock.length
    },
    lowStock,
    recentTickets,
    statusDistribution,
    technicianWorkload,
    recentActivity
  };
}

// ==================================================================
// STAFF — front-desk operations: today's workload, customers,
// payments to chase, handovers due. No revenue, no technician
// workload, no shop-wide financial data.
// ==================================================================
async function staffDashboard() {
  const [[counts]] = await pool.query(`
    SELECT
      SUM(CASE WHEN status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) AS active_tickets,
      SUM(CASE WHEN status = 'Ready for Delivery' THEN 1 ELSE 0 END) AS ready_for_delivery,
      SUM(CASE WHEN status NOT IN ('Delivered','Cancelled') AND payment_status != 'Paid' THEN 1 ELSE 0 END) AS pending_payments,
      SUM(CASE WHEN status = 'Delivered' AND DATE(updated_at) = CURDATE() THEN 1 ELSE 0 END) AS handovers_today
    FROM service_tickets WHERE is_draft = 0
  `);

  const [recentCustomers] = await pool.query(
    'SELECT id, name, phone, email, created_at FROM customers ORDER BY created_at DESC LIMIT 6'
  );

  const [readyTickets] = await pool.query(`
    SELECT t.id, t.ticket_number, t.device_type, t.brand, t.payment_status, c.name AS customer_name
    FROM service_tickets t JOIN customers c ON c.id = t.customer_id
    WHERE t.status = 'Ready for Delivery' ORDER BY t.updated_at ASC LIMIT 8
  `);

  const [recentTickets] = await pool.query(`
    SELECT t.id, t.ticket_number, t.device_type, t.brand, t.status, t.payment_status, t.created_at,
           c.name AS customer_name
    FROM service_tickets t JOIN customers c ON c.id = t.customer_id
    WHERE t.is_draft = 0
    ORDER BY t.created_at DESC LIMIT 8
  `);

  return {
    role: 'staff',
    totals: {
      active_tickets: counts.active_tickets || 0,
      ready_for_delivery: counts.ready_for_delivery || 0,
      pending_payments: counts.pending_payments || 0,
      handovers_today: counts.handovers_today || 0
    },
    recentCustomers,
    readyTickets,
    recentTickets
  };
}

// ==================================================================
// TECHNICIAN — personal workboard only: their own jobs, grouped into
// the 7 stages from spec section 33, plus what's due today. Nothing
// about other technicians, revenue, or shop-wide numbers.
// ==================================================================
const BOARD_COLUMNS = [
  { key: 'new', label: 'New Assignment', statuses: ['Received', 'Assigned'] },
  { key: 'inspection', label: 'Inspection', statuses: ['Inspection'] },
  { key: 'diagnosing', label: 'Diagnosing', statuses: ['Diagnosing', 'Waiting for Approval'] },
  { key: 'waitingParts', label: 'Waiting for Parts', statuses: ['Waiting for Parts'] },
  { key: 'repairing', label: 'Repairing', statuses: ['Repair In Progress'] },
  { key: 'testing', label: 'Testing', statuses: ['Testing'] },
  { key: 'completed', label: 'Completed', statuses: ['Repair Completed', 'Ready for Delivery'] }
];

async function technicianDashboard(userId) {
  const [techRow] = await pool.query('SELECT id, name FROM technicians WHERE user_id = ?', [userId]);
  if (techRow.length === 0) {
    return {
      role: 'technician',
      unlinked: true,
      totals: { assigned: 0, due_today: 0 },
      columns: BOARD_COLUMNS.map(c => ({ key: c.key, label: c.label, jobs: [] })),
      recentActivity: []
    };
  }
  const techId = techRow[0].id;

  const [[counts]] = await pool.query(`
    SELECT
      COUNT(*) AS assigned,
      SUM(CASE WHEN expected_date = CURDATE() AND status NOT IN ('Delivered','Cancelled') THEN 1 ELSE 0 END) AS due_today
    FROM service_tickets WHERE technician_id = ? AND is_draft = 0
  `, [techId]);

  const [myTickets] = await pool.query(`
    SELECT t.id, t.ticket_number, t.device_type, t.brand, t.model, t.status, t.expected_date,
           c.name AS customer_name
    FROM service_tickets t JOIN customers c ON c.id = t.customer_id
    WHERE t.technician_id = ? AND t.is_draft = 0 AND t.status NOT IN ('Delivered','Cancelled')
    ORDER BY t.expected_date IS NULL, t.expected_date ASC
  `, [techId]);

  const columns = BOARD_COLUMNS.map(c => ({
    key: c.key, label: c.label,
    jobs: myTickets.filter(t => c.statuses.includes(t.status))
  }));

  const [recentActivity] = await pool.query(`
    SELECT h.status, h.note, h.changed_at, t.ticket_number
    FROM ticket_status_history h
    JOIN service_tickets t ON t.id = h.ticket_id
    WHERE t.technician_id = ?
    ORDER BY h.changed_at DESC LIMIT 8
  `, [techId]);

  return {
    role: 'technician',
    unlinked: false,
    totals: {
      assigned: counts.assigned || 0,
      due_today: counts.due_today || 0
    },
    columns,
    recentActivity
  };
}

module.exports = router;

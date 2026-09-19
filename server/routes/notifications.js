const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

// GET /api/notifications
// Notifications are computed live from existing tables rather than a
// separately-maintained notifications table — this keeps the "unread"
// state trivially always-correct (there is no state to go stale) and
// avoids building an external notification service, per spec section 25.
router.get('/', asyncHandler(async (req, res) => {
  const items = [];

  if (req.user.role === 'admin') {
    const [[lowStock]] = await pool.query('SELECT COUNT(*) AS c FROM parts WHERE quantity <= min_stock');
    if (lowStock.c > 0) items.push({ type: 'warning', message: `${lowStock.c} part(s) are low or out of stock.`, link: 'inventory.html' });

    const [[overdue]] = await pool.query(
      "SELECT COUNT(*) AS c FROM service_tickets WHERE expected_date < CURDATE() AND is_draft = 0 AND status NOT IN ('Delivered','Cancelled')"
    );
    if (overdue.c > 0) items.push({ type: 'danger', message: `${overdue.c} ticket(s) are overdue.`, link: 'tickets.html' });

    const [[unpaid]] = await pool.query("SELECT COUNT(*) AS c FROM invoices WHERE payment_status != 'Paid'");
    if (unpaid.c > 0) items.push({ type: 'warning', message: `${unpaid.c} invoice(s) are unpaid or partially paid.`, link: 'billing.html' });

    const [[pendingHandover]] = await pool.query("SELECT COUNT(*) AS c FROM service_tickets WHERE status = 'Ready for Delivery'");
    if (pendingHandover.c > 0) items.push({ type: 'info', message: `${pendingHandover.c} ticket(s) ready for handover.`, link: 'tickets.html' });
  }

  if (req.user.role === 'staff') {
    const [[ready]] = await pool.query("SELECT COUNT(*) AS c FROM service_tickets WHERE status = 'Ready for Delivery'");
    if (ready.c > 0) items.push({ type: 'info', message: `${ready.c} ticket(s) ready for delivery.`, link: 'tickets.html' });

    const [[unpaid]] = await pool.query(
      "SELECT COUNT(*) AS c FROM service_tickets WHERE is_draft = 0 AND status NOT IN ('Delivered','Cancelled') AND payment_status != 'Paid'"
    );
    if (unpaid.c > 0) items.push({ type: 'warning', message: `${unpaid.c} active ticket(s) have unpaid balances.`, link: 'billing.html' });

    const [[overdue]] = await pool.query(
      "SELECT COUNT(*) AS c FROM service_tickets WHERE expected_date < CURDATE() AND is_draft = 0 AND status NOT IN ('Delivered','Cancelled')"
    );
    if (overdue.c > 0) items.push({ type: 'danger', message: `${overdue.c} ticket(s) are overdue.`, link: 'tickets.html' });
  }

  if (req.user.role === 'technician') {
    const [techRow] = await pool.query('SELECT id FROM technicians WHERE user_id = ?', [req.user.id]);
    const techId = techRow[0] ? techRow[0].id : null;
    if (techId) {
      const [[newAssignments]] = await pool.query(
        "SELECT COUNT(*) AS c FROM service_tickets WHERE technician_id = ? AND is_draft = 0 AND status IN ('Received','Assigned')", [techId]
      );
      if (newAssignments.c > 0) items.push({ type: 'info', message: `${newAssignments.c} new job(s) assigned to you.`, link: 'tickets.html' });

      const [[dueToday]] = await pool.query(
        "SELECT COUNT(*) AS c FROM service_tickets WHERE technician_id = ? AND is_draft = 0 AND expected_date = CURDATE() AND status NOT IN ('Delivered','Cancelled')",
        [techId]
      );
      if (dueToday.c > 0) items.push({ type: 'warning', message: `${dueToday.c} job(s) due today.`, link: 'tickets.html' });
    }
  }

  res.json(items);
}));

module.exports = router;

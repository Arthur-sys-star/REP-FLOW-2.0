const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { nextCode } = require('../utils/idGenerator');
const { logActivity } = require('../utils/audit');
const { makeUploader, relativePath } = require('../utils/upload');

const router = express.Router();
router.use(verifyToken);

const photoUpload = makeUploader('tickets');

// The forward order of the repair workflow. 'Draft' is NOT a status value —
// draft-ness is tracked separately via the is_draft column — and 'Delivered'
// is deliberately excluded from this list's use in PATCH /:id/status below;
// it can only be reached through the Handover checklist (see handover.js),
// so a ticket can never be marked Delivered directly.
const STATUS_FLOW = [
  'Received', 'Assigned', 'Inspection', 'Diagnosing',
  'Waiting for Approval', 'Waiting for Parts',
  'Repair In Progress', 'Testing', 'Repair Completed',
  'Ready for Delivery'
];
const ALL_STATUSES = [...STATUS_FLOW, 'Delivered', 'Cancelled'];

// Which statuses each role may move a ticket INTO via PATCH /:id/status.
// Admin is unrestricted (within STATUS_FLOW + Cancelled — still never Delivered).
const ROLE_ALLOWED_TARGETS = {
  staff: ['Received', 'Assigned', 'Waiting for Approval', 'Ready for Delivery', 'Cancelled'],
  technician: ['Inspection', 'Diagnosing', 'Waiting for Parts', 'Repair In Progress', 'Testing', 'Repair Completed']
};

function computeTotal(ticket, partsCost) {
  return Number(ticket.service_charge) + Number(partsCost) + Number(ticket.other_charges) - Number(ticket.discount);
}

async function getMyTechnicianId(userId) {
  const [rows] = await pool.query('SELECT id FROM technicians WHERE user_id = ?', [userId]);
  return rows[0] ? rows[0].id : null;
}

// GET /api/tickets?status=&search=&technicianId=&draftsOnly=
router.get('/', asyncHandler(async (req, res) => {
  const { status, search, technicianId, draftsOnly } = req.query;
  const clauses = [];
  const params = [];

  if (draftsOnly) {
    // Drafts are private, incomplete work-in-progress — never in the main
    // list unless explicitly asked for (the "My Drafts" view), and only
    // ever visible to the staff member who created them, or admin.
    clauses.push('t.is_draft = 1');
    if (req.user.role !== 'admin') {
      clauses.push('t.created_by = ?');
      params.push(req.user.id);
    }
  } else {
    clauses.push('t.is_draft = 0');
    if (status) {
      clauses.push('t.status = ?');
      params.push(status);
    }
  }

  if (req.user.role === 'technician') {
    const myTechId = (await getMyTechnicianId(req.user.id)) ?? -1;
    clauses.push('t.technician_id = ?');
    params.push(myTechId);
  } else if (technicianId) {
    clauses.push('t.technician_id = ?');
    params.push(technicianId);
  }

  if (search) {
    clauses.push('(t.ticket_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR t.brand LIKE ? OR t.model LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone,
            tech.name AS technician_name
     FROM service_tickets t
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN technicians tech ON tech.id = t.technician_id
     ${where}
     ORDER BY t.created_at DESC`,
    params
  );
  res.json(rows);
}));

// GET /api/tickets/:id — full detail: ticket, parts used, photos, status history, computed total
router.get('/:id', asyncHandler(async (req, res) => {
  const [ticketRows] = await pool.query(
    `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
            c.address AS customer_address, tech.name AS technician_name
     FROM service_tickets t
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN technicians tech ON tech.id = t.technician_id
     WHERE t.id = ?`,
    [req.params.id]
  );
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  const ticket = ticketRows[0];

  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || ticket.technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only view tickets assigned to you.' });
    }
  }
  if (ticket.is_draft && req.user.role !== 'admin' && ticket.created_by !== req.user.id) {
    return res.status(403).json({ message: 'This draft belongs to another staff member.' });
  }

  const [parts] = await pool.query(
    `SELECT tp.*, p.name AS part_name, p.sku FROM ticket_parts tp
     JOIN parts p ON p.id = tp.part_id WHERE tp.ticket_id = ?`,
    [req.params.id]
  );
  const partsCost = parts.reduce((sum, p) => sum + Number(p.quantity) * Number(p.unit_cost_at_use), 0);

  const [history] = await pool.query(
    `SELECT h.*, u.name AS changed_by_name FROM ticket_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.ticket_id = ? ORDER BY h.changed_at ASC`,
    [req.params.id]
  );

  const [photos] = await pool.query(
    `SELECT p.*, u.name AS uploaded_by_name FROM ticket_photos p
     LEFT JOIN users u ON u.id = p.uploaded_by
     WHERE p.ticket_id = ? ORDER BY p.uploaded_at ASC`,
    [req.params.id]
  );

  const [invoiceRows] = await pool.query('SELECT * FROM invoices WHERE ticket_id = ?', [req.params.id]);
  const [handoverRows] = await pool.query('SELECT * FROM handover_records WHERE ticket_id = ?', [req.params.id]);

  res.json({
    ticket: { ...ticket, computed_total: computeTotal(ticket, partsCost), parts_cost: partsCost },
    parts,
    history,
    photos: {
      before: photos.filter(p => p.photo_type === 'BEFORE'),
      after: photos.filter(p => p.photo_type === 'AFTER')
    },
    invoice: invoiceRows[0] || null,
    handover: handoverRows[0] || null
  });
}));

// POST /api/tickets — create a ticket (intake only — no charges, per spec 6.8)
router.post('/', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const {
    customer_id, device_type, brand, model, serial_number, device_color,
    condition_notes, accessories, reported_problem, expected_date, is_draft
  } = req.body;

  if (!customer_id) {
    return res.status(400).json({ message: 'A customer is required.' });
  }
  const draft = !!is_draft;
  if (!draft && (!device_type || !brand || !reported_problem)) {
    return res.status(400).json({ message: 'Device type, brand and reported problem are required to submit a ticket.' });
  }

  const [customerCheck] = await pool.query('SELECT id FROM customers WHERE id = ?', [customer_id]);
  if (customerCheck.length === 0) {
    return res.status(400).json({ message: 'Selected customer does not exist.' });
  }

  const ticketNumber = await nextCode(pool, 'service_tickets', 'SR', 'ticket_number');
  const accessoriesJson = JSON.stringify(Array.isArray(accessories) ? accessories : (accessories ? [accessories] : []));
  // 'status' always holds a real workflow value — draft-ness lives entirely
  // in is_draft, never encoded as a fake status.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO service_tickets
        (ticket_number, customer_id, device_type, brand, model, serial_number, device_color,
         condition_notes, accessories, reported_problem, expected_date, status, payment_status, is_draft, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Received', 'Pending', ?, ?)`,
      [ticketNumber, customer_id, (device_type || '').trim(), (brand || '').trim(), model || null,
       serial_number || null, device_color || null, condition_notes || null, accessoriesJson,
       (reported_problem || '').trim(), expected_date || null, draft ? 1 : 0, req.user.id]
    );

    if (!draft) {
      await conn.query(
        `INSERT INTO ticket_status_history (ticket_id, status, note, changed_by)
         VALUES (?, 'Received', 'Ticket created', ?)`,
        [result.insertId, req.user.id]
      );
    }

    await conn.commit();
    await logActivity(pool, {
      user: req.user, action: draft ? 'Saved ticket draft' : `Created ticket ${ticketNumber}`,
      entityType: 'ticket', entityId: result.insertId
    });
    const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// PATCH /api/tickets/:id/submit — finalize a draft into a real, active ticket
router.patch('/:id/submit', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  const ticket = existing[0];

  if (!ticket.is_draft) {
    return res.status(400).json({ message: 'This ticket has already been submitted.' });
  }
  if (req.user.role !== 'admin' && ticket.created_by !== req.user.id) {
    return res.status(403).json({ message: 'You can only submit your own drafts.' });
  }
  if (!ticket.device_type || !ticket.brand || !ticket.reported_problem) {
    return res.status(400).json({ message: 'Device type, brand and reported problem are required to submit a ticket.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE service_tickets SET is_draft = 0 WHERE id = ?', [req.params.id]);
    await conn.query(
      `INSERT INTO ticket_status_history (ticket_id, status, note, changed_by) VALUES (?, 'Received', 'Ticket submitted', ?)`,
      [req.params.id, req.user.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await logActivity(pool, { user: req.user, action: `Submitted ticket ${ticket.ticket_number}`, entityType: 'ticket', entityId: Number(req.params.id) });
  const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// PUT /api/tickets/:id — update ticket fields
router.put('/:id', requireRole('admin', 'staff', 'technician'), asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

  // Technicians may only update diagnosis / repair notes on tickets they're assigned to.
  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || existing[0].technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only update tickets assigned to you.' });
    }
    const { diagnosis, repair_notes } = req.body;
    await pool.query(
      'UPDATE service_tickets SET diagnosis = COALESCE(?, diagnosis), repair_notes = COALESCE(?, repair_notes) WHERE id = ?',
      [diagnosis ?? null, repair_notes ?? null, req.params.id]
    );
    const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
    return res.json(row[0]);
  }

  // Admin / staff — intake & assignment fields. Charges are handled by
  // PATCH /:id/charges, not here, so intake edits can never accidentally
  // touch the bill.
  const {
    technician_id, device_type, brand, model, serial_number, device_color,
    condition_notes, accessories, reported_problem, expected_date
  } = req.body;
  const accessoriesJson = accessories === undefined ? undefined
    : JSON.stringify(Array.isArray(accessories) ? accessories : (accessories ? [accessories] : []));

  await pool.query(
    `UPDATE service_tickets SET
       technician_id = ?, device_type = COALESCE(?, device_type), brand = COALESCE(?, brand),
       model = ?, serial_number = ?, device_color = ?, condition_notes = ?,
       accessories = COALESCE(?, accessories),
       reported_problem = COALESCE(?, reported_problem), expected_date = ?
     WHERE id = ?`,
    [technician_id ?? existing[0].technician_id, device_type || null, brand || null,
     model ?? existing[0].model, serial_number ?? existing[0].serial_number,
     device_color ?? existing[0].device_color, condition_notes ?? existing[0].condition_notes,
     accessoriesJson, reported_problem || null, expected_date ?? existing[0].expected_date,
     req.params.id]
  );

  const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// PATCH /api/tickets/:id/charges — service charge / other charges / discount
// (deliberately separate from PUT so intake edits can never touch billing).
router.patch('/:id/charges', requireRole('admin', 'staff', 'technician'), asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  if (existing[0].is_draft) {
    return res.status(400).json({ message: 'Submit this draft before adding charges.' });
  }

  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || existing[0].technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only update tickets assigned to you.' });
    }
  }

  const { service_charge, other_charges, discount } = req.body;
  // Discount and "other charges" are business/pricing decisions — technicians
  // may only set the labour/service charge for the repair they performed.
  const isTechnician = req.user.role === 'technician';

  await pool.query(
    `UPDATE service_tickets SET
       service_charge = COALESCE(?, service_charge)
       ${isTechnician ? '' : ', other_charges = COALESCE(?, other_charges), discount = COALESCE(?, discount)'}
     WHERE id = ?`,
    isTechnician
      ? [service_charge, req.params.id]
      : [service_charge, other_charges, discount, req.params.id]
  );

  const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// PATCH /api/tickets/:id/status — move ticket through the status flow, recording history
router.patch('/:id/status', requireRole('admin', 'staff', 'technician'), asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  if (!STATUS_FLOW.includes(status) && status !== 'Cancelled') {
    return res.status(400).json({ message: `Invalid status. Must be one of: ${[...STATUS_FLOW, 'Cancelled'].join(', ')}` });
  }

  const [existing] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  if (existing[0].is_draft) {
    return res.status(400).json({ message: 'Submit this draft before changing its status.' });
  }

  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || existing[0].technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only update tickets assigned to you.' });
    }
  }
  const allowedTargets = ROLE_ALLOWED_TARGETS[req.user.role];
  if (allowedTargets && !allowedTargets.includes(status)) {
    return res.status(403).json({ message: `Your role cannot move a ticket to "${status}".` });
  }

  if (['Delivered', 'Cancelled'].includes(existing[0].status)) {
    return res.status(400).json({ message: `Ticket is already ${existing[0].status} and cannot be changed further.` });
  }

  // Prevent invalid transitions: forward-only through the flow, except
  // 'Cancelled' which is reachable from any non-terminal status.
  if (status !== 'Cancelled') {
    const currentIndex = STATUS_FLOW.indexOf(existing[0].status);
    const targetIndex = STATUS_FLOW.indexOf(status);
    if (targetIndex <= currentIndex) {
      return res.status(400).json({
        message: `Cannot move backward or repeat a status. Ticket is currently "${existing[0].status}".`
      });
    }
  }

  // A repair cannot be marked completed without at least one AFTER photo on
  // record — this is a real backend check, not just a disabled button.
  if (status === 'Repair Completed') {
    const [[{ afterCount }]] = await pool.query(
      "SELECT COUNT(*) AS afterCount FROM ticket_photos WHERE ticket_id = ? AND photo_type = 'AFTER'",
      [req.params.id]
    );
    if (afterCount === 0) {
      return res.status(400).json({ message: 'Upload at least one after-repair photo before marking the repair completed.' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE service_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
    await conn.query(
      'INSERT INTO ticket_status_history (ticket_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
      [req.params.id, status, note || null, req.user.id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [row] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  res.json(row[0]);
}));

// DELETE /api/tickets/:id — discard a Draft only (real tickets are never deleted, to preserve history)
router.delete('/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM service_tickets WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  if (!existing[0].is_draft) {
    return res.status(400).json({ message: 'Only draft tickets can be discarded. Submitted tickets are kept for service history.' });
  }
  if (req.user.role !== 'admin' && existing[0].created_by !== req.user.id) {
    return res.status(403).json({ message: 'You can only discard your own drafts.' });
  }
  await pool.query('DELETE FROM service_tickets WHERE id = ?', [req.params.id]);
  res.json({ message: 'Draft discarded.' });
}));

// ------------------------------------------------------------
// Parts (inventory deduction happens here, with a full audit trail)
// ------------------------------------------------------------

// POST /api/tickets/:id/parts — attach a spare part, verifying & deducting stock in one transaction
router.post('/:id/parts', requireRole('admin', 'staff', 'technician'), asyncHandler(async (req, res) => {
  const { part_id, quantity } = req.body;
  const qty = Number(quantity);

  if (!part_id || !qty || qty <= 0) {
    return res.status(400).json({ message: 'A valid part and quantity greater than zero are required.' });
  }

  const [ticketRows] = await pool.query('SELECT id, status, technician_id, is_draft FROM service_tickets WHERE id = ?', [req.params.id]);
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });
  if (ticketRows[0].is_draft) {
    return res.status(400).json({ message: 'Submit this draft before adding parts.' });
  }
  if (['Delivered', 'Cancelled'].includes(ticketRows[0].status)) {
    return res.status(400).json({ message: `Cannot add parts to a ticket that is ${ticketRows[0].status}.` });
  }
  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || ticketRows[0].technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only use parts on tickets assigned to you.' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the part row so concurrent requests can't both pass the stock check.
    const [partRows] = await conn.query('SELECT * FROM parts WHERE id = ? FOR UPDATE', [part_id]);
    if (partRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Part not found.' });
    }
    const part = partRows[0];

    if (part.quantity < qty) {
      await conn.rollback();
      return res.status(400).json({
        message: `Insufficient stock for "${part.name}". Available: ${part.quantity}, requested: ${qty}.`
      });
    }

    const newStock = part.quantity - qty;
    await conn.query('UPDATE parts SET quantity = ? WHERE id = ?', [newStock, part_id]);

    // What's charged to the customer is the part's selling price, frozen at
    // the moment it's used — not the shop's internal purchase cost.
    await conn.query(
      `INSERT INTO ticket_parts (ticket_id, part_id, quantity, unit_cost_at_use)
       VALUES (?, ?, ?, ?)`,
      [req.params.id, part_id, qty, part.selling_price]
    );

    await conn.query(
      `INSERT INTO inventory_transactions
        (part_id, type, quantity, ticket_id, user_id, previous_stock, new_stock, reason)
       VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?)`,
      [part_id, qty, req.params.id, req.user.id, part.quantity, newStock, 'Used on repair ticket']
    );

    await conn.commit();
    await logActivity(pool, {
      user: req.user, action: `Used ${qty} x ${part.name} on ticket`,
      entityType: 'ticket', entityId: Number(req.params.id), details: `Part: ${part.name} (${part.sku})`
    });

    const [updatedPart] = await pool.query('SELECT * FROM parts WHERE id = ?', [part_id]);
    res.status(201).json({
      message: `${qty} x ${part.name} added to ticket. Stock deducted.`,
      lowStock: updatedPart[0].quantity <= updatedPart[0].min_stock,
      part: updatedPart[0]
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// DELETE /api/tickets/:id/parts/:ticketPartId — remove a used part and restock it
router.delete('/:id/parts/:ticketPartId', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM ticket_parts WHERE id = ? AND ticket_id = ?',
      [req.params.ticketPartId, req.params.id]
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Part usage record not found on this ticket.' });
    }

    const [partRows] = await conn.query('SELECT * FROM parts WHERE id = ? FOR UPDATE', [rows[0].part_id]);
    const part = partRows[0];
    const newStock = part.quantity + rows[0].quantity;

    await conn.query('UPDATE parts SET quantity = ? WHERE id = ?', [newStock, rows[0].part_id]);
    await conn.query('DELETE FROM ticket_parts WHERE id = ?', [req.params.ticketPartId]);
    await conn.query(
      `INSERT INTO inventory_transactions
        (part_id, type, quantity, ticket_id, user_id, previous_stock, new_stock, reason)
       VALUES (?, 'RETURN', ?, ?, ?, ?, ?, ?)`,
      [rows[0].part_id, rows[0].quantity, req.params.id, req.user.id, part.quantity, newStock, 'Removed from ticket']
    );

    await conn.commit();
    await logActivity(pool, {
      user: req.user, action: `Returned ${rows[0].quantity} x ${part.name} from ticket`,
      entityType: 'ticket', entityId: Number(req.params.id)
    });
    res.json({ message: 'Part removed from ticket and stock restored.' });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// ------------------------------------------------------------
// Before / After repair photos
// ------------------------------------------------------------

// POST /api/tickets/:id/photos  (multipart/form-data: photo, photo_type, caption)
router.post('/:id/photos', requireRole('admin', 'staff', 'technician'), photoUpload.single('photo'), asyncHandler(async (req, res) => {
  const { photo_type, caption } = req.body;
  if (!['BEFORE', 'AFTER'].includes(photo_type)) {
    return res.status(400).json({ message: 'photo_type must be BEFORE or AFTER.' });
  }
  if (!req.file) {
    return res.status(400).json({ message: 'No image file received.' });
  }

  const [ticketRows] = await pool.query('SELECT id, status, technician_id FROM service_tickets WHERE id = ?', [req.params.id]);
  if (ticketRows.length === 0) return res.status(404).json({ message: 'Ticket not found.' });

  // Technicians document AFTER photos for their own jobs; staff/admin
  // typically capture BEFORE photos at intake but may add either.
  if (req.user.role === 'technician') {
    const myTechId = await getMyTechnicianId(req.user.id);
    if (!myTechId || ticketRows[0].technician_id !== myTechId) {
      return res.status(403).json({ message: 'You can only upload photos for tickets assigned to you.' });
    }
    if (photo_type !== 'AFTER') {
      return res.status(403).json({ message: 'Technicians upload AFTER-repair photos only.' });
    }
  }

  const filePath = relativePath('tickets', req.file.filename);
  const [result] = await pool.query(
    `INSERT INTO ticket_photos (ticket_id, photo_type, file_path, caption, uploaded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [req.params.id, photo_type, filePath, caption || null, req.user.id]
  );

  await logActivity(pool, {
    user: req.user, action: `Uploaded ${photo_type} photo`, entityType: 'ticket', entityId: Number(req.params.id)
  });

  const [row] = await pool.query('SELECT * FROM ticket_photos WHERE id = ?', [result.insertId]);
  res.status(201).json(row[0]);
}));

// DELETE /api/tickets/:id/photos/:photoId
router.delete('/:id/photos/:photoId', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const [result] = await pool.query(
    'DELETE FROM ticket_photos WHERE id = ? AND ticket_id = ?',
    [req.params.photoId, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ message: 'Photo not found on this ticket.' });
  res.json({ message: 'Photo removed.' });
}));

module.exports = router;

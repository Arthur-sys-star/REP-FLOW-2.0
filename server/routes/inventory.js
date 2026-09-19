const express = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/audit');

const router = express.Router();
router.use(verifyToken);

// Status is always derived from quantity vs min_stock — never stored, so it
// can never drift out of sync with the actual numbers.
const STATUS_CASE = `
  CASE
    WHEN quantity <= 0 THEN 'Out of Stock'
    WHEN quantity <= min_stock THEN 'Low Stock'
    ELSE 'In Stock'
  END AS stock_status
`;

// GET /api/inventory?lowStock=true&search=&category=
router.get('/', asyncHandler(async (req, res) => {
  const { lowStock, search, category } = req.query;
  const clauses = [];
  const params = [];
  if (lowStock === 'true') clauses.push('quantity <= min_stock');
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (search) {
    clauses.push('(name LIKE ? OR sku LIKE ? OR category LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts ${where} ORDER BY name ASC`, params);
  res.json(rows);
}));

// GET /api/inventory/:id/transactions — full audit trail for one part
router.get('/:id/transactions', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT it.*, t.ticket_number, u.name AS user_name
    FROM inventory_transactions it
    LEFT JOIN service_tickets t ON t.id = it.ticket_id
    LEFT JOIN users u ON u.id = it.user_id
    WHERE it.part_id = ? ORDER BY it.created_at DESC
  `, [req.params.id]);
  res.json(rows);
}));

// POST /api/inventory — add a new part
router.post('/', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, category, sku, supplier, location, quantity, purchase_price, selling_price, min_stock } = req.body;
  if (!name || !sku) {
    return res.status(400).json({ message: 'Part name and SKU are required.' });
  }
  const openingQty = quantity || 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO parts (name, category, sku, supplier, location, quantity, purchase_price, selling_price, min_stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), category || 'General', sku.trim(), supplier || null, location || null,
       openingQty, purchase_price || 0, selling_price || null, min_stock ?? 2]
    );
    if (openingQty > 0) {
      await conn.query(
        `INSERT INTO inventory_transactions (part_id, type, quantity, user_id, previous_stock, new_stock, reason)
         VALUES (?, 'IN', ?, ?, 0, ?, 'Opening stock')`,
        [result.insertId, openingQty, req.user.id, openingQty]
      );
    }
    await conn.commit();
    await logActivity(pool, { user: req.user, action: `Added part "${name}" to inventory`, entityType: 'part', entityId: result.insertId });
    const [row] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts WHERE id = ?`, [result.insertId]);
    res.status(201).json(row[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// PUT /api/inventory/:id — edit part metadata (NOT quantity — that only
// changes through Stock In / Stock Out / Correction below, so every stock
// movement is always traceable in inventory_transactions).
router.put('/:id', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { name, category, sku, supplier, location, purchase_price, selling_price, min_stock } = req.body;
  const [existing] = await pool.query('SELECT id FROM parts WHERE id = ?', [req.params.id]);
  if (existing.length === 0) return res.status(404).json({ message: 'Part not found.' });

  await pool.query(
    `UPDATE parts SET
       name = COALESCE(?, name), category = COALESCE(?, category), sku = COALESCE(?, sku),
       supplier = ?, location = ?, purchase_price = COALESCE(?, purchase_price),
       selling_price = ?, min_stock = COALESCE(?, min_stock)
     WHERE id = ?`,
    [name || null, category || null, sku || null, supplier || null, location || null,
     purchase_price, selling_price || null, min_stock, req.params.id]
  );
  const [row] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts WHERE id = ?`, [req.params.id]);
  res.json(row[0]);
}));

// POST /api/inventory/:id/stock-in — new stock arriving from a supplier
router.post('/:id/stock-in', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { quantity, supplier, reference_number } = req.body;
  const qty = Number(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ message: 'Quantity must be greater than zero.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [partRows] = await conn.query('SELECT * FROM parts WHERE id = ? FOR UPDATE', [req.params.id]);
    if (partRows.length === 0) { await conn.rollback(); return res.status(404).json({ message: 'Part not found.' }); }
    const newStock = partRows[0].quantity + qty;
    await conn.query('UPDATE parts SET quantity = ? WHERE id = ?', [newStock, req.params.id]);
    await conn.query(
      `INSERT INTO inventory_transactions (part_id, type, quantity, user_id, supplier, reference_number, previous_stock, new_stock)
       VALUES (?, 'IN', ?, ?, ?, ?, ?, ?)`,
      [req.params.id, qty, req.user.id, supplier || null, reference_number || null, partRows[0].quantity, newStock]
    );
    await conn.commit();
    await logActivity(pool, { user: req.user, action: `Stock in: +${qty} x ${partRows[0].name}`, entityType: 'part', entityId: Number(req.params.id) });
    const [row] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts WHERE id = ?`, [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// POST /api/inventory/:id/stock-out — manual removal not tied to a ticket
// (e.g. damaged / written off). Admin may set allow_negative to force it
// through anyway — an intentional, explicit override, never the default.
router.post('/:id/stock-out', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { quantity, reason, allow_negative } = req.body;
  const qty = Number(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ message: 'Quantity must be greater than zero.' });
  if (!reason) return res.status(400).json({ message: 'A reason is required for manual stock-out.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [partRows] = await conn.query('SELECT * FROM parts WHERE id = ? FOR UPDATE', [req.params.id]);
    if (partRows.length === 0) { await conn.rollback(); return res.status(404).json({ message: 'Part not found.' }); }

    const willBeNegative = partRows[0].quantity - qty < 0;
    if (willBeNegative && !(allow_negative && req.user.role === 'admin')) {
      await conn.rollback();
      return res.status(400).json({ message: `Insufficient stock. Available: ${partRows[0].quantity}.` });
    }

    const newStock = partRows[0].quantity - qty;
    await conn.query('UPDATE parts SET quantity = ? WHERE id = ?', [newStock, req.params.id]);
    await conn.query(
      `INSERT INTO inventory_transactions (part_id, type, quantity, user_id, previous_stock, new_stock, reason)
       VALUES (?, 'OUT', ?, ?, ?, ?, ?)`,
      [req.params.id, qty, req.user.id, partRows[0].quantity, newStock, reason]
    );
    await conn.commit();
    await logActivity(pool, { user: req.user, action: `Stock out: -${qty} x ${partRows[0].name} (${reason})`, entityType: 'part', entityId: Number(req.params.id) });
    const [row] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts WHERE id = ?`, [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// POST /api/inventory/:id/correction — reconcile a stock count discrepancy
router.post('/:id/correction', requireRole('admin', 'staff'), asyncHandler(async (req, res) => {
  const { new_quantity, reason } = req.body;
  const target = Number(new_quantity);
  if (new_quantity === undefined || target < 0 || Number.isNaN(target)) {
    return res.status(400).json({ message: 'A valid new quantity (0 or more) is required.' });
  }
  if (!reason) return res.status(400).json({ message: 'A reason is required for a stock correction.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [partRows] = await conn.query('SELECT * FROM parts WHERE id = ? FOR UPDATE', [req.params.id]);
    if (partRows.length === 0) { await conn.rollback(); return res.status(404).json({ message: 'Part not found.' }); }

    const change = target - partRows[0].quantity;
    await conn.query('UPDATE parts SET quantity = ? WHERE id = ?', [target, req.params.id]);
    // The transaction log always stores a positive magnitude (schema requires
    // quantity > 0); previous_stock/new_stock is what conveys direction.
    // A no-op correction (target === current) is allowed but not logged.
    if (change !== 0) {
      await conn.query(
        `INSERT INTO inventory_transactions (part_id, type, quantity, user_id, previous_stock, new_stock, reason)
         VALUES (?, 'CORRECTION', ?, ?, ?, ?, ?)`,
        [req.params.id, Math.abs(change), req.user.id, partRows[0].quantity, target, reason]
      );
    }
    await conn.commit();
    await logActivity(pool, { user: req.user, action: `Stock correction: ${partRows[0].name} set to ${target} (${reason})`, entityType: 'part', entityId: Number(req.params.id) });
    const [row] = await pool.query(`SELECT *, ${STATUS_CASE} FROM parts WHERE id = ?`, [req.params.id]);
    res.json(row[0]);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// DELETE /api/inventory/:id — admin only
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const [result] = await pool.query('DELETE FROM parts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ message: 'Part not found.' });
  await logActivity(pool, { user: req.user, action: `Deleted part #${req.params.id} from inventory`, entityType: 'part', entityId: Number(req.params.id) });
  res.json({ message: 'Part deleted successfully.' });
}));

module.exports = router;

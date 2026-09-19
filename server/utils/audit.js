// Writes one row to audit_logs. Never throws — a failed audit write should
// never block the actual business operation that triggered it.
async function logActivity(pool, { user, action, entityType = null, entityId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, role, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user?.id || null, user?.name || null, user?.role || null, action, entityType, entityId, details]
    );
  } catch (err) {
    console.error('audit log write failed (ignored):', err.message);
  }
}

module.exports = { logActivity };

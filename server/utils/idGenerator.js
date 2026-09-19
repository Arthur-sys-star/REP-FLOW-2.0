// Generates human-friendly sequential codes like SR-0007 / INV-0007.
// Checks for collisions (e.g. after a deletion) and increments until free.
// Good enough for a mini-project; a production system would use a
// dedicated sequence table to fully avoid race conditions under load.
async function nextCode(pool, table, prefix, column) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM ${table}`);
  let n = rows[0].cnt + 1;
  // guard against a rare collision if rows were deleted earlier
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = `${prefix}-${String(n).padStart(4, '0')}`;
    const [exists] = await pool.query(`SELECT id FROM ${table} WHERE ${column} = ? LIMIT 1`, [code]);
    if (exists.length === 0) return code;
    n++;
  }
  // fallback: timestamp-based, virtually guaranteed unique
  return `${prefix}-${Date.now()}`;
}

module.exports = { nextCode };

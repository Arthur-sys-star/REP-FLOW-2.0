function notFound(req, res, next) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Express recognizes this as an error handler because it takes 4 args.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[Rep-Flow API Error]', err);

  // MySQL duplicate entry (e.g. unique email, SKU, ticket_number)
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A record with this value already exists.' });
  }
  // MySQL FK constraint violations
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    return res.status(409).json({ message: 'This record is linked to other data and cannot be deleted.' });
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ message: 'Referenced record does not exist.' });
  }
  // Any other MySQL-level error (bad column, connection reset mid-query,
  // constraint violation we haven't named above, etc.) — never forward the
  // raw SQL error text or SQLSTATE to the browser; the real detail is
  // already in the server log above.
  if (err.code && (err.code.startsWith('ER_') || err.sqlState)) {
    return res.status(500).json({ message: 'Unable to complete this request. Please contact the administrator.' });
  }
  // Multer upload errors (file too large, too many files) get a friendly
  // pass-through — their messages are already written for end users.
  if (err.name === 'MulterError') {
    return res.status(400).json({ message: err.message });
  }

  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Something went wrong on the server.'
  });
}

module.exports = { notFound, errorHandler };

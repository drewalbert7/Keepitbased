/**
 * Destructive DELETE routes require an explicit confirmation header so clients
 * (and proxies) cannot remove data accidentally or via CSRF-style tricks on GET-capable clients.
 *
 * Send: X-Confirm-Delete: 1
 *
 * Set SKIP_DELETE_CONFIRMATION=true only for local automation (never in production).
 */

function requireDeleteConfirmation(req, res, next) {
  if (process.env.SKIP_DELETE_CONFIRMATION === 'true') {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        message: 'SKIP_DELETE_CONFIRMATION cannot be used in production'
      });
    }
    return next();
  }
  const raw = req.get('X-Confirm-Delete');
  if (raw === '1' || raw === 'true') {
    return next();
  }
  return res.status(400).json({
    message:
      'Deletion requires confirmation. Send header X-Confirm-Delete: 1 with this request.'
  });
}

module.exports = requireDeleteConfirmation;

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err?.status && err.expose !== false && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.code === '22P02') return res.status(404).json({ error: 'Not found' }); // invalid uuid in URL
  if (err?.code === '23505') return res.status(409).json({ error: 'That value already exists.' });
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}

/** Throwable HTTP error: throw httpError(404, 'Not found') */
function httpError(status, message, details) {
  const e = new Error(message); e.status = status; if (details) e.details = details; return e;
}
module.exports = { errorHandler, httpError };

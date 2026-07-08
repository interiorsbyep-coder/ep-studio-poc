// Express 4 doesn't forward rejected promises from async handlers to error middleware.
// Wrapping each route in this catches them so a DB error returns a clean 500.
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

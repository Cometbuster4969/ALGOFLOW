/**
 * Optional LAN API key. Set ALGOFLOW_API_KEY to require x-api-key on /api/* routes.
 * Health and static assets stay public.
 */

function optionalApiKey(req, res, next) {
  const expected = process.env.ALGOFLOW_API_KEY;
  if (!expected) return next();

  const provided = req.headers["x-api-key"];
  if (provided && provided === expected) return next();

  return res.status(401).json({
    error: "UNAUTHORIZED",
    message: "Missing or invalid x-api-key header",
  });
}

module.exports = { optionalApiKey };

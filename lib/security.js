"use strict";
// NOTE on auth: ChatGPT's Developer Mode connector UI only supports
// "OAuth" or "No Authentication" for the MCP endpoint itself — it cannot send
// a custom header/API key (see OpenAI Apps SDK auth docs). So MCP_API_KEY is
// intentionally NOT enforced on /sse or /messages; it only protects the REST
// dashboard API (/api/*), which you load directly in a browser. Treat your
// ngrok URL as semi-private (don't post it publicly) for /sse protection.

function apiKeyMiddleware(req, res, next) {
  const required = process.env.MCP_API_KEY;
  if (!required) return next(); // auth disabled — local/dev default
  const provided = req.header("x-api-key") || req.query.api_key;
  if (provided !== required) return res.status(401).json({ error: "Invalid or missing API key" });
  next();
}

// Simple fixed-window limiter per client IP. Good enough to blunt accidental
// hammering or abuse of a public ngrok URL; not a substitute for a real
// gateway if this is ever exposed at scale.
function rateLimiter({ windowMs = 60000, max = 120 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  return function rateLimit(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.status(429).json({ error: "Rate limit exceeded — slow down" });
      return;
    }
    next();
  };
}

module.exports = { apiKeyMiddleware, rateLimiter };

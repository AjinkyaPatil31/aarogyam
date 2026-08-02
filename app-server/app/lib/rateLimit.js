// Basic in-memory rate limiter for a single node environment
// Maps IP/identifier to { count, firstRequestTime }
const rateLimitCache = new Map();

export function rateLimit(identifier, limit = 5, windowMs = 60000) {
  const now = Date.now();
  
  if (!rateLimitCache.has(identifier)) {
    rateLimitCache.set(identifier, { count: 1, firstRequestTime: now });
    return { success: true };
  }

  const record = rateLimitCache.get(identifier);
  
  if (now - record.firstRequestTime > windowMs) {
    // Reset window
    record.count = 1;
    record.firstRequestTime = now;
    return { success: true };
  }

  if (record.count >= limit) {
    return { success: false, retryAfter: Math.ceil((windowMs - (now - record.firstRequestTime)) / 1000) };
  }

  record.count += 1;
  return { success: true };
}

// Cleanup interval to prevent memory leaks in the Map
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitCache.entries()) {
    if (now - record.firstRequestTime > 60000 * 5) {
      rateLimitCache.delete(key);
    }
  }
}, 60000 * 10);

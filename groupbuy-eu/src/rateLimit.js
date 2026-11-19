// Small in-memory fixed-window rate limiter (single app instance, which is what SQLite implies).
export function createRateLimiter({ windowMs, max, clock }) {
  const hits = new Map();
  return {
    // Returns true if the request is allowed.
    take(key) {
      const now = clock.now().getTime();
      let entry = hits.get(key);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
      }
      return entry.count <= max;
    },
  };
}

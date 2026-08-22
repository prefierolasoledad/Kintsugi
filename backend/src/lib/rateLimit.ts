/**
 * Minimal fixed-window rate limiter.
 *
 * In-memory, so the counters are per-process: correct for a single instance,
 * but replicas would each get their own allowance. A shared store (Redis) is
 * required before scaling out — this is deliberately the simple version rather
 * than something that looks distributed and isn't.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Keeps the map from growing without bound in a long-running process. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

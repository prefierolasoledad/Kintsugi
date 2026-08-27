import { createClient, type RedisClientType } from "redis";

/**
 * Fixed-window rate limiting, shared across instances when Redis is configured.
 *
 * WHY THIS IS NOT JUST A MAP ANY MORE
 * The counters guard eleven endpoints and several are security controls, not
 * politeness: `admin-stepup` at 8 per fifteen minutes is the only reason a
 * six-digit TOTP cannot be brute-forced. Held in-process, every limit silently
 * multiplies by the number of replicas — three instances turn that 8 into 24,
 * which is a different security posture arrived at by accident.
 *
 * See docs/adr/0018-redis-for-shared-ephemeral-state.md
 *
 * WHAT LIVES HERE, AND WHAT DOES NOT
 * Counters that expire. Nothing else. Redis is never a source of truth in this
 * codebase — everything that must survive a restart is in Postgres, and keeping
 * that line sharp is what stops this becoming a second database.
 */

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export type RateLimitOptions = {
  /**
   * What to do when the shared store cannot be reached.
   *
   * Default is to fail OPEN: allow the request and log loudly, matching how the
   * breached-password check already behaves. A defence in depth should not take
   * the site down when it is unavailable.
   *
   * Pass true for limits where unlimited attempts are worse than an outage.
   * `admin-stepup` is the one that qualifies: unbounded guessing at the admin
   * panel beats nobody opening it for ten minutes.
   */
  failClosed?: boolean;
};

/* ------------------------------------------------------------------ *
 * In-memory fallback
 *
 * Kept, not deleted. With no REDIS_URL the suite and a single-instance
 * deployment need no extra service — and the startup banner says which is in
 * use, so nobody has to guess whether their limits are actually shared.
 * ------------------------------------------------------------------ */

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

function checkInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
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

/* ------------------------------------------------------------------ *
 * Redis
 * ------------------------------------------------------------------ */

function redisUrl(): string | undefined {
  const raw = process.env.REDIS_URL;
  if (raw === undefined) return undefined;
  // Trimmed, blank treated as absent — a leading space is truthy and would pass
  // every "is it configured?" check before failing at connect time.
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isRedisConfigured(): boolean {
  return redisUrl() !== undefined;
}

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

/**
 * INCREMENT AND EXPIRE IN ONE ROUND TRIP.
 *
 * The obvious version is INCR followed by EXPIRE, which is two commands. A
 * dropped connection between them leaves a key with NO TTL — a counter that
 * never resets, locking the user out permanently. Evaluated server-side, the
 * two cannot come apart.
 *
 * Returns the new count and the milliseconds remaining, so one call decides
 * both whether to allow and what to tell the caller about retrying.
 */
const INCR_AND_EXPIRE = `
  local n = redis.call('INCR', KEYS[1])
  if n == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { n, redis.call('PTTL', KEYS[1]) }
`;

async function getClient(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is not set");

  connecting = (async () => {
    const c = createClient({
      url,
      socket: {
        // Bounded: five attempts with a rising delay, then give up and let the
        // failure policy decide. An unbounded reconnect loop turns a dead Redis
        // into a request that hangs rather than one that fails.
        reconnectStrategy: (attempts) => (attempts > 5 ? false : Math.min(attempts * 200, 2000)),
        connectTimeout: 3000,
      },
    }) as RedisClientType;

    // Without a listener, a connection error is an unhandled 'error' event and
    // takes the process down — which would make a Redis blip fatal to the API.
    c.on("error", (err) => {
      console.error("[rate-limit] redis error:", (err as Error).message);
    });

    await c.connect();
    client = c;
    return c;
  })();

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

/** Checked at startup so the banner can say which store is in use. */
export async function assertRateLimitStore(): Promise<string> {
  if (!isRedisConfigured()) {
    return "in-memory (per-process; limits multiply by the number of instances)";
  }
  const c = await getClient();
  await c.ping();
  return `redis (${redisUrl()}) — shared across instances`;
}

/* ------------------------------------------------------------------ *
 * The check
 * ------------------------------------------------------------------ */

/**
 * Records an attempt and says whether it is allowed.
 *
 * ASYNC, because the counter may not be in this process. Every call site awaits
 * it. A version that kept the synchronous signature would have to guess, and a
 * rate limiter that guesses is not one.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: RateLimitOptions = {}
): Promise<RateLimitResult> {
  if (!isRedisConfigured()) {
    return checkInMemory(key, limit, windowMs);
  }

  try {
    const c = await getClient();
    const reply = (await c.eval(INCR_AND_EXPIRE, {
      keys: [`ratelimit:${key}`],
      arguments: [String(windowMs)],
    })) as [number, number];

    const count = Number(reply[0]);
    const ttlMs = Number(reply[1]);

    if (count > limit) {
      return {
        allowed: false,
        // PTTL answers -1 for a key with no expiry and -2 if it vanished
        // between the INCR and the read. Neither should happen, and falling
        // back to the window keeps the advice sane if it does.
        retryAfterSeconds: Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch (err) {
    /**
     * The store is unreachable. There is no good answer, only two bad ones.
     *
     * Loud either way: a rate limiter running blind is something an operator
     * needs to know about, and silence here is how a security control goes
     * missing for a week without anyone noticing.
     */
    console.error(
      `[rate-limit] shared store unreachable for "${key}" ` +
        `(${(err as Error).message}) — ${opts.failClosed ? "REFUSING" : "allowing"} the request`
    );

    if (opts.failClosed) {
      return { allowed: false, retryAfterSeconds: 30 };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Test-only: drops the in-memory buckets so a suite can start clean. */
export function __resetInMemoryLimits() {
  buckets.clear();
  lastSweep = 0;
}

/** Closes the connection so a process can exit without a lingering socket. */
export async function disconnectRateLimitStore() {
  if (client?.isReady) await client.quit();
  client = null;
}

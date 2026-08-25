/**
 * Assertions, and the shape every suite shares.
 *
 * Previously each suite carried its own copy of `check()` — fourteen of them,
 * drifting apart. One copy here means a fix to the reporting applies everywhere,
 * and it gives the runner a single place to collect totals from.
 */

export type Result = { label: string; ok: boolean; detail: string };

export class Suite {
  readonly name: string;
  readonly results: Result[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Records one assertion.
   *
   * `detail` is printed only on failure, and should carry the ACTUAL value.
   * A failure that says "expected true" and nothing else costs a debugging
   * round trip every time.
   */
  check(ok: boolean, label: string, detail: unknown = ""): boolean {
    const text = typeof detail === "string" ? detail : JSON.stringify(detail);
    this.results.push({ label, ok, detail: text });
    if (ok) {
      console.log(`  PASS  ${label}`);
    } else {
      console.log(`  FAIL  ${label}${text ? ` — ${text}` : ""}`);
    }
    return ok;
  }

  /** A labelled group, purely to make long output readable. */
  section(title: string) {
    console.log(`\n[${title}]`);
  }

  note(message: string) {
    console.log(`      ${message}`);
  }

  get passed() {
    return this.results.filter((r) => r.ok).length;
  }

  get failed() {
    return this.results.filter((r) => !r.ok).length;
  }
}

/**
 * Runs one suite to completion and reports.
 *
 * `cleanup` is passed separately and runs in a finally, because a suite that
 * throws halfway is exactly when leftover data does damage — this codebase has
 * had a half-finished run mark real listings SOLD and quietly shrink the shop
 * three times. Cleanup is not the suite's last statement; it is unconditional.
 */
export async function runSuite(
  name: string,
  body: (t: Suite) => Promise<void>,
  cleanup?: (t: Suite) => Promise<void>
): Promise<Suite> {
  const t = new Suite(name);
  console.log("=".repeat(70));
  console.log(name.toUpperCase());
  console.log("=".repeat(70));

  let thrown: unknown = null;
  try {
    await body(t);
  } catch (err) {
    thrown = err;
    t.check(false, "suite ran to completion", String((err as Error)?.message ?? err).slice(0, 200));
  } finally {
    if (cleanup) {
      console.log("\ncleaning up");
      try {
        await cleanup(t);
      } catch (err) {
        t.check(false, "cleanup succeeded", String((err as Error)?.message ?? err).slice(0, 200));
      }
    }
  }

  console.log(`\n${t.passed} passed, ${t.failed} failed`);
  if (thrown) console.error(thrown);
  return t;
}

/**
 * Entry point for running a suite as its own process.
 *
 * CALL THIS WITHOUT `await`: `void main(...)`. tsx compiles this project as
 * CJS, where top-level await is a hard transform error. Nothing is lost — this
 * ends by exiting the process.
 */
export async function main(
  name: string,
  body: (t: Suite) => Promise<void>,
  cleanup?: (t: Suite) => Promise<void>
) {
  const t = await runSuite(name, body, cleanup);
  const { disconnect } = await import("./db");
  await disconnect();
  process.exit(t.failed === 0 ? 0 : 1);
}

/** Ctrl+C must still clean up. Suites register their teardown here. */
const onInterrupt: Array<() => Promise<void>> = [];

export function cleanupOnInterrupt(fn: () => Promise<void>) {
  onInterrupt.push(fn);
}

let interruptWired = false;
export function wireInterrupt() {
  if (interruptWired) return;
  interruptWired = true;
  process.once("SIGINT", async () => {
    console.log("\ninterrupted — cleaning up");
    for (const fn of onInterrupt) {
      try {
        await fn();
      } catch {
        // Best effort; an interrupt is already an abnormal exit.
      }
    }
    const { disconnect } = await import("./db");
    await disconnect().catch(() => {});
    process.exit(130);
  });
}

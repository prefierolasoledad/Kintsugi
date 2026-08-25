import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(import.meta.dirname, "..", ".env") });
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Payment safety, end to end against a running server.
 *
 * WHY THIS EXISTS
 * The double-charge race it covers was a live bug: five simultaneous pay
 * requests produced five successful charges. A status check before the provider
 * call is not enough, because the check and the charge are two separate steps.
 * Each case below maps to a specific way that can go wrong.
 *
 * Needs the API on :4000 and a seeded catalog. Restores every listing it
 * touches, and asserts that it did.
 *
 *   npm run test:payments
 */

const B = process.env.TEST_API_URL ?? "http://localhost:4000";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const PASSWORD = "correct horse battery staple 9";

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

function jar() {
  const c = new Map<string, string>();
  return {
    header: () => [...c].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb: (r: Response) => {
      for (const sc of r.headers.getSetCookie()) {
        const [pair] = sc.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) c.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
  };
}
type Jar = ReturnType<typeof jar>;

async function call(j: Jar, method: string, path: string, body?: unknown) {
  const r = await fetch(`${B}${path}`, {
    method,
    headers: { cookie: j.header(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  j.absorb(r);
  const t = r.status === 204 ? "" : await r.text();
  let json: any = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = { raw: t }; }
  return { status: r.status, json };
}

const emails: string[] = [];
async function buyer(tag: string) {
  const email = `dbl.${tag}@example.com`;
  emails.push(email);
  await prisma.user.deleteMany({ where: { email } });
  await fetch(`${B}/auth/signup`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Buyer ${tag}`, email, password: PASSWORD }),
  });
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
  const j = jar();
  await call(j, "POST", "/auth/login", { email, password: PASSWORD });

  // Checkout requires a delivery address. Created through the API rather than
  // inserted directly, so this suite goes through the same door a buyer does.
  await call(j, "POST", "/addresses", {
    fullName: "Payment Test",
    line1: "12 Kiln Lane",
    city: "Bristol",
    postcode: "BS1 4TR",
    country: "GB",
  });
  return j;
}

/**
 * listing id -> stock before the test touched it.
 *
 * Restoring a flat quantity 1 at cleanup is wrong and silently corrupted a
 * seeded set-of-three once already. Record what was there and put that back.
 */
const originalStock = new Map<string, number>();

async function freshListing(minQuantity = 1) {
  const r = await fetch(`${B}/catalog/listings?limit=40`).then((r) => r.json());
  const l = r.listings.find(
    (x: any) => !originalStock.has(x.id) && x.quantity >= minQuantity
  );
  if (!l) throw new Error(`ran out of listings with quantity >= ${minQuantity}`);
  const row = await prisma.listing.findUniqueOrThrow({
    where: { id: l.id },
    select: { quantity: true },
  });
  originalStock.set(l.id, row.quantity);
  return l;
}

async function orderFor(j: Jar, minQuantity = 1) {
  const listing = await freshListing(minQuantity);
  // Stock is not uniformly 1 in the catalog, so assertions have to compare
  // against what this particular listing actually had.
  const before = { quantity: originalStock.get(listing.id)! };
  const held = await call(j, "POST", "/reservations", { listingId: listing.id, quantity: 1 });
  if (held.status !== 201 && held.status !== 200) {
    throw new Error(`could not hold ${listing.id}: ${held.status} ${JSON.stringify(held.json)}`);
  }
  const created = await call(j, "POST", "/orders");
  if (created.status !== 201) throw new Error(`checkout failed: ${JSON.stringify(created.json)}`);
  return {
    listing,
    quantityBefore: before.quantity,
    order: created.json.order,
    payment: created.json.payment,
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("DOUBLE-PAYMENT PREVENTION");
  console.log("=".repeat(70));

  const j = await buyer("main");

  /* ---------------------------------------------------------------- *
   * 1. The bug this was built for: N simultaneous pay requests.
   * ---------------------------------------------------------------- */
  console.log("\n[1] five simultaneous pay requests for one order");
  {
    const { order } = await orderFor(j);
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" })
      )
    );
    const ok = results.filter((r) => r.status === 200 && r.json?.outcome === "succeeded");
    const refused = results.filter((r) => r.status === 409);
    const codes = refused.map((r) => r.json?.code);

    console.log(`      statuses: ${JSON.stringify(results.map((r) => r.status))}`);
    console.log(`      codes:    ${JSON.stringify(results.map((r) => r.json?.outcome ?? r.json?.code))}`);

    check(ok.length === 1, "exactly one request charged", `got ${ok.length}`);
    check(refused.length === N - 1, `the other ${N - 1} were refused`, `got ${refused.length}`);
    check(
      codes.every((c) => c === "PAYMENT_IN_PROGRESS" || c === "ALREADY_PAID"),
      "refusals used a payment-specific code",
      JSON.stringify(codes)
    );

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paidAt: true } });
    check(row.status === "PAID", "order ended PAID", row.status);
    check(row.paidAt !== null, "paidAt recorded");
  }

  /* ---------------------------------------------------------------- *
   * 2. Sequential retry after success.
   * ---------------------------------------------------------------- */
  console.log("\n[2] paying an already-paid order");
  {
    const { order } = await orderFor(j);
    const first = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(first.json?.outcome === "succeeded", "first payment succeeded");
    const again = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(again.status === 409 && again.json?.code === "ALREADY_PAID", "second refused as ALREADY_PAID",
      `${again.status} ${again.json?.code}`);

    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: order.items[0].id ? (await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id }, select: { listingId: true } })).listingId! : "" },
      select: { status: true, quantity: true },
    });
    check(listing.status === "SOLD" && listing.quantity === 0, "listing marked SOLD once",
      `${listing.status} q=${listing.quantity}`);
  }

  /* ---------------------------------------------------------------- *
   * 2b. Buying ONE of several identical pieces.
   *
   * This is a regression test for a destructive bug: payment forced
   * `status: SOLD, quantity: 0` on every line, so buying one of three
   * skillets deleted the other two from the shop. It survived every earlier
   * test because they all happened to pick quantity-1 listings — the bug was
   * only found in a real order placed by the site's owner.
   * ---------------------------------------------------------------- */
  console.log("\n[2b] buying one of several identical pieces");
  {
    const { listing, order, quantityBefore } = await orderFor(j, 2);
    console.log(`      "${listing.title}" had ${quantityBefore} in stock`);
    check(quantityBefore >= 2, "picked a multi-quantity listing", String(quantityBefore));

    const paid = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(paid.json?.outcome === "succeeded", "payment succeeded");

    const l = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { status: true, quantity: true },
    });
    check(l.quantity === quantityBefore - 1, "exactly one was taken out of stock",
      `q=${l.quantity}, expected ${quantityBefore - 1}`);
    check(l.status === "ACTIVE", "the listing is still for sale", l.status);

    const catalog = await fetch(`${B}/catalog/listings?limit=40`).then((r) => r.json());
    check(catalog.listings.some((x: any) => x.id === listing.id),
      "and still visible in the catalog");
  }

  /* ---------------------------------------------------------------- *
   * 3. A malformed card must not strand the order in PROCESSING.
   *    This is why validation runs before the claim.
   * ---------------------------------------------------------------- */
  console.log("\n[3] a typo must not lock the order");
  {
    const { order } = await orderFor(j);
    const bad = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242" });
    check(bad.status === 400, "malformed number rejected with 400", String(bad.status));

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    check(row.status === "PENDING_PAYMENT", "order still PENDING_PAYMENT, not stuck", row.status);

    const retry = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(retry.json?.outcome === "succeeded", "buyer can still pay after the typo");
  }

  /* ---------------------------------------------------------------- *
   * 4. A decline is definitive: stock returns, no money moved.
   * ---------------------------------------------------------------- */
  console.log("\n[4] declined card");
  {
    const { listing, order, quantityBefore } = await orderFor(j);
    const declined = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4000000000000002" });
    check(declined.json?.outcome === "failed", "reported as failed", JSON.stringify(declined.json?.outcome));
    check(/declin/i.test(declined.json?.reason ?? ""), "reason mentions the decline", declined.json?.reason);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paidAt: true } });
    check(row.status === "FAILED", "order FAILED", row.status);
    check(row.paidAt === null, "paidAt left null");

    const l = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { status: true, quantity: true } });
    check(l.status === "ACTIVE" && l.quantity === quantityBefore, "stock returned to the catalog",
      `${l.status} q=${l.quantity}, expected ${quantityBefore}`);
  }

  /* ---------------------------------------------------------------- *
   * 5. Concurrent declines: the claim must serialise these too.
   * ---------------------------------------------------------------- */
  console.log("\n[5] five simultaneous declines");
  {
    const { order } = await orderFor(j);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4000000000000002" })
      )
    );
    const attempted = results.filter((r) => r.status === 200);
    check(attempted.length === 1, "only one attempt reached the provider", `got ${attempted.length}`);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    check(row.status === "FAILED", "order settled as FAILED", row.status);
  }

  /* ---------------------------------------------------------------- *
   * 6. 3-D Secure: pending is not failure, and stock stays committed.
   * ---------------------------------------------------------------- */
  console.log("\n[6] card needing authentication stays in flight");
  {
    const { listing, order, quantityBefore } = await orderFor(j);
    const pending = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4000002500003155" });
    check(pending.json?.outcome === "pending", "reported as pending, not failed", JSON.stringify(pending.json?.outcome));

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    check(row.status === "PROCESSING", "order held in PROCESSING", row.status);

    const l = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id }, select: { quantity: true } });
    check(l.quantity === quantityBefore - 1, "stock still committed while in flight",
      `q=${l.quantity}, expected ${quantityBefore - 1}`);

    const cancel = await call(j, "POST", `/orders/${order.id}/cancel`);
    check(cancel.status === 409 && cancel.json?.code === "PAYMENT_IN_PROGRESS",
      "cannot cancel while a charge may be in flight", `${cancel.status} ${cancel.json?.code}`);

    const retry = await call(j, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(retry.status === 409 && retry.json?.code === "PAYMENT_IN_PROGRESS",
      "cannot start a second payment either", `${retry.status} ${retry.json?.code}`);

    // Left in flight on purpose: [9] proves reconciliation settles it.
    (globalThis as any).__pendingOrderId = order.id;
    (globalThis as any).__pendingListingId = listing.id;
    (globalThis as any).__pendingQtyBefore = quantityBefore;
  }

  /* ---------------------------------------------------------------- *
   * 7. Ownership: another buyer cannot pay or see it.
   * ---------------------------------------------------------------- */
  console.log("\n[7] cross-buyer isolation");
  {
    const { order } = await orderFor(j);
    const other = await buyer("other");
    const peek = await call(other, "GET", `/orders/${order.id}`);
    check(peek.status === 404, "stranger gets 404, not 403", String(peek.status));
    const pay = await call(other, "POST", `/orders/${order.id}/pay`, { cardNumber: "4242424242424242" });
    check(pay.status === 404, "stranger cannot pay it", String(pay.status));
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    check(row.status === "PENDING_PAYMENT", "the claim was never taken by the stranger", row.status);
    await call(j, "POST", `/orders/${order.id}/cancel`);
  }

  /* ---------------------------------------------------------------- *
   * 8. A forged webhook must not mark anything paid.
   * ---------------------------------------------------------------- */
  console.log("\n[8] unsigned webhook");
  {
    const forged = await fetch(`${B}/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: "pi_stub_forged" } } }),
    });
    check(forged.status === 400, "rejected without a valid signature", String(forged.status));
    const body = await forged.json().catch(() => ({}));
    check(!/secret|sk_/i.test(JSON.stringify(body)), "no secret leaked in the error");
  }

  /* ---------------------------------------------------------------- *
   * 9. Reconciliation settles an order left mid-payment.
   * ---------------------------------------------------------------- */
  console.log("\n[9] reconciliation of an in-flight payment");
  {
    const orderId = (globalThis as any).__pendingOrderId as string;
    const listingId = (globalThis as any).__pendingListingId as string;
    const qtyBefore = (globalThis as any).__pendingQtyBefore as number;

    // Backdate past both windows: the 2-minute reconcile TTL and the 30-minute
    // abandonment window, so the sweeper treats it as a dead 3-D Secure prompt.
    // "id" is a text column, so no uuid cast.
    await prisma.$executeRaw`
      UPDATE "orders"
      SET "updatedAt" = NOW() - INTERVAL '40 minutes',
          "createdAt" = NOW() - INTERVAL '40 minutes'
      WHERE "id" = ${orderId}
    `;
    console.log("      waiting for the sweeper (interval is 60s)...");

    let settled: string | null = null;
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
      if (row.status !== "PROCESSING") { settled = row.status; break; }
    }
    check(settled !== null, "sweeper settled the stuck order", settled ?? "still PROCESSING after 100s");
    // The stub left this intent in requires_action — pending, never succeeded.
    // Inventing a payment here would be the worst possible outcome.
    check(settled !== "PAID", "did not invent a payment that never completed", String(settled));
    check(settled === "CANCELLED", "settled as CANCELLED", String(settled));
    console.log(`      settled as: ${settled}`);

    const l = await prisma.listing.findUniqueOrThrow({ where: { id: listingId }, select: { status: true, quantity: true } });
    check(l.quantity === qtyBefore && l.status === "ACTIVE", "stock came back out of the deadlock",
      `${l.status} q=${l.quantity}, expected ${qtyBefore}`);

    // The intent must be dead, or a late 3-D Secure completion would pay for
    // stock we just put back on sale.
    const retry = await call(j, "POST", `/orders/${orderId}/pay`, { cardNumber: "4242424242424242" });
    check(retry.status === 409, "the cancelled order is not payable again", String(retry.status));
  }

  /* ---------------------------------------------------------------- *
   * 10. No card data anywhere in the database.
   * ---------------------------------------------------------------- */
  console.log("\n[10] card data is never persisted");
  {
    const orders = await prisma.order.findMany({ select: { id: true, paymentIntentId: true, failureReason: true, paymentProvider: true } });
    const items = await prisma.orderItem.findMany();
    const blob = JSON.stringify({ orders, items });
    for (const n of ["4242424242424242", "4000000000000002", "4000002500003155", "4242", "0002"]) {
      check(!blob.includes(n), `no trace of ${n}`);
    }
    check(orders.every((o) => !o.paymentIntentId || o.paymentIntentId.startsWith("pi_")), "only provider references stored");
  }

  console.log("\n" + "=".repeat(70));
  console.log(`${pass} passed, ${fail} failed`);
  console.log("=".repeat(70));
}

/* -------------------------------------------------------------------- *
 * Cleanup
 *
 * MUST run on every exit path, including Ctrl+C.
 *
 * This suite buys real listings and marks them SOLD, and a SOLD listing is
 * hidden from the catalog. So an interrupted run does not just leave stray
 * rows — it silently removes items from the shop. That happened three times
 * during development, twice to listings the owner had created, which is why
 * this is wired to `finally` and to SIGINT rather than sitting at the end of
 * main() where a Ctrl+C during the 60-second sweeper wait skips it entirely.
 * -------------------------------------------------------------------- */
let cleanedUp = false;

async function cleanup(reason: string) {
  if (cleanedUp) return;
  cleanedUp = true;

  console.log(`\ncleaning up (${reason})`);
  try {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await prisma.order.deleteMany({ where: { buyerId: { in: users.map((u) => u.id) } } });
    await prisma.reservation.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });

    for (const [id, quantity] of originalStock) {
      await prisma.listing.update({ where: { id }, data: { status: "ACTIVE", quantity } });
    }

    /**
     * Scoped to what this run touched, not counted globally.
     *
     * A global "are any listings SOLD?" check flags real purchases by real
     * users as test residue, which sent me hunting a phantom leak once
     * already. Only the listings and accounts this suite created are its
     * business.
     */
    const notRestored: string[] = [];
    for (const [id, quantity] of originalStock) {
      const l = await prisma.listing.findUnique({
        where: { id },
        select: { title: true, status: true, quantity: true },
      });
      if (!l) continue;
      if (l.status !== "ACTIVE" || l.quantity !== quantity) {
        notRestored.push(`${l.title} (${l.status} q=${l.quantity}, expected ACTIVE q=${quantity})`);
      }
    }

    const testUsersLeft = await prisma.user.count({ where: { email: { in: emails } } });
    const holds = await prisma.reservation.count({
      where: { status: "HELD", user: { email: { in: emails } } },
    });

    console.log(
      `  listings touched: ${originalStock.size}, not restored: ${notRestored.length}` +
        `  test users left: ${testUsersLeft}  holds left: ${holds}`
    );

    if (notRestored.length || testUsersLeft || holds) {
      // Loud, because the failure mode is a quietly smaller shop.
      console.error("\n  WARNING: state left behind:");
      for (const n of notRestored) console.error(`    ${n}`);
      console.error("  Re-run this suite, or reseed with: npx prisma db seed\n");
    }
  } catch (err) {
    console.error("  cleanup itself failed:", err);
  }
}

process.once("SIGINT", async () => {
  await cleanup("interrupted");
  await prisma.$disconnect();
  process.exit(130);
});

// Not top-level await: tsx compiles this project's .ts as CJS, where top-level
// await is a syntax error.
async function run() {
  let exitCode = 0;
  try {
    await main();
    exitCode = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error(err);
    exitCode = 1;
  } finally {
    await cleanup(exitCode === 0 ? "finished" : "after failure");
    await prisma.$disconnect();
  }
  process.exit(exitCode);
}

run();

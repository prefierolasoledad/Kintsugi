import { prisma, requireServices } from "../lib/db";
import { Scope, buyOne } from "../lib/fixtures";
import { cleanupOnInterrupt, main, wireInterrupt } from "../lib/harness";
import { RefundStatus, RefundTrigger, ReturnStatus } from "../../src/generated/prisma/enums";

/**
 * Returns, over HTTP, all the way to money.
 *
 * WHY SEPARATELY FROM `returns.ts`
 * That suite proves the eligibility rules and the state machine, and it runs
 * below HTTP so none of it touches a route or a payment provider. This one
 * drives the whole thing the way a person does — buy, deliver, ask, answer —
 * and is the only place an approval actually calls the provider and produces a
 * real `Refund` row. It is also where the authorisation lives: four parties can
 * reach these endpoints and three of them must be turned away.
 */

const scope = new Scope("returnroutes");
wireInterrupt();
cleanupOnInterrupt(() => scope.cleanup());

void main(
  "return endpoints",
  async (t) => {
    await requireServices({ api: true, web: true });

    const { seller, listing } = await scope.ownListing("shop", {
      priceCents: 6_400,
      title: "A returnable teacup",
    });
    const buyer = await scope.buyer("buyer");
    const stranger = await scope.buyer("stranger");

    /* ============================================================ *
     * 1. Nothing to return yet.
     * ============================================================ */
    t.section("1. before anything is delivered");

    const { paid } = await buyOne(buyer, listing.id);
    t.check(paid.status === 200 && paid.json.outcome === "succeeded", "the buyer pays",
      `${paid.status} ${paid.json?.outcome ?? paid.json?.error ?? ""}`);

    const sale = await seller.get("/api/seller/sales").then((r) => r.json.sales[0]);
    t.check(!!sale, "the sale reaches the seller", sale?.title);

    const tooEarly = await buyer.get(`/api/orders/items/${sale.id}/return`);
    t.check(tooEarly.status === 200 && tooEarly.json.eligible === false,
      "the item is not returnable before delivery", JSON.stringify(tooEarly.json));
    t.check(tooEarly.json.code === "NOT_DELIVERED",
      "and says so specifically, rather than a generic refusal", tooEarly.json?.code);

    const openedEarly = await buyer.post(`/api/orders/items/${sale.id}/return`, {
      reason: "I have decided I do not want this after all",
    });
    t.check(openedEarly.status === 409 && openedEarly.json.code === "NOT_DELIVERED",
      "and opening one is refused", `${openedEarly.status} ${openedEarly.json?.code}`);

    /* ============================================================ *
     * 2. Whose item is it.
     * ============================================================ */
    t.section("2. only the buyer on the order");

    const peek = await stranger.get(`/api/orders/items/${sale.id}/return`);
    t.check(peek.status === 404,
      "somebody else's line is a 404, not a 403 — an id is not a way to ask what was bought",
      peek.status);

    const strangerAsking = await stranger.post(`/api/orders/items/${sale.id}/return`, {
      reason: "this is not my order but let me try anyway",
    });
    t.check(strangerAsking.status === 404, "and they cannot open one either",
      strangerAsking.status);

    /* ============================================================ *
     * 3. Delivered, then asked for.
     * ============================================================ */
    t.section("3. asking for a return");

    t.check((await seller.post(`/api/seller/sales/${sale.id}/ship`, {})).status === 200,
      "the seller ships it");
    t.check((await buyer.post(`/api/orders/items/${sale.id}/delivered`)).status === 200,
      "the buyer confirms delivery");

    const now = await buyer.get(`/api/orders/items/${sale.id}/return`);
    t.check(now.json.eligible === true, "now it is returnable", JSON.stringify(now.json));
    t.check(now.json.amountCents === 6_400, "for the line's own price", now.json?.amountCents);
    t.check(typeof now.json.deadline === "string",
      "with a deadline the page can show", now.json?.deadline);
    t.check(typeof now.json.windowDays === "number",
      "and the window length, so nothing is hardcoded in the UI", now.json?.windowDays);

    const tooShort = await buyer.post(`/api/orders/items/${sale.id}/return`, { reason: "broken" });
    t.check(tooShort.status === 400,
      "a one-word reason is refused — the seller has to be able to act on it",
      `${tooShort.status} ${tooShort.json?.code}`);

    const opened = await buyer.post(`/api/orders/items/${sale.id}/return`, {
      reason: "There is a chip on the rim that was not in any of the photos.",
      notAsDescribed: true,
    });
    t.check(opened.status === 201, "the return opens",
      `${opened.status} ${JSON.stringify(opened.json)}`);
    const returnId: string = opened.json.id;

    const again = await buyer.post(`/api/orders/items/${sale.id}/return`, {
      reason: "Asking a second time to see what happens.",
    });
    t.check(again.status === 409 && again.json.code === "ALREADY_REQUESTED",
      "asking twice is refused", `${again.status} ${again.json?.code}`);

    const mine = await buyer.get("/api/orders/returns");
    t.check(mine.status === 200 && mine.json.returns.length === 1,
      "the buyer can see their own request", mine.json?.returns?.length);
    t.check(mine.json.returns[0].title === "A returnable teacup",
      "with the item named", mine.json.returns[0]?.title);
    t.check(mine.json.returns[0].status === "OPEN", "and its state",
      mine.json.returns[0]?.status);

    const strangersList = await stranger.get("/api/orders/returns");
    t.check(strangersList.json.returns.length === 0, "another buyer sees none of it",
      strangersList.json?.returns?.length);

    /* ============================================================ *
     * 4. The seller's queue.
     * ============================================================ */
    t.section("4. the seller answers");

    const queue = await seller.get("/api/seller/returns?filter=open");
    t.check(queue.status === 200 && queue.json.returns.length === 1,
      "it appears in the seller's queue", queue.json?.returns?.length);
    t.check(queue.json.returns[0].reason.includes("chip on the rim"),
      "carrying the buyer's own words", queue.json.returns[0]?.reason);
    t.check(queue.json.returns[0].notAsDescribed === true,
      "and whether they called it misdescribed");

    /* ---- a different seller cannot answer it ---- */
    const otherSeller = await scope.seller("othershop");
    const reachingIn = await otherSeller.post(`/api/seller/returns/${returnId}/respond`, {
      approve: true,
    });
    t.check(reachingIn.status === 404,
      "another seller cannot answer it — 404, not 403", reachingIn.status);

    /* ---- refusing needs a note ---- */
    const silent = await seller.post(`/api/seller/returns/${returnId}/respond`, {
      approve: false,
    });
    t.check(silent.status === 400 && silent.json.code === "NOTE_REQUIRED",
      "refusing with no reason is refused", `${silent.status} ${silent.json?.code}`);

    const refused = await seller.post(`/api/seller/returns/${returnId}/respond`, {
      approve: false,
      note: "The chip is visible in the third photo and it was listed as repaired.",
    });
    t.check(refused.status === 200 && refused.json.status === "REFUSED", "the seller refuses",
      `${refused.status} ${refused.json?.status}`);

    const seesWhy = await buyer.get("/api/orders/returns");
    t.check(seesWhy.json.returns[0].decisionNote?.includes("third photo"),
      "and the buyer is told why, in the seller's words",
      seesWhy.json.returns[0]?.decisionNote);

    /* ============================================================ *
     * 5. Escalation.
     * ============================================================ */
    t.section("5. escalating a refusal");

    const strangerEscalating = await stranger.post(`/api/orders/returns/${returnId}/escalate`, {});
    t.check(strangerEscalating.status === 404, "somebody else cannot escalate it",
      strangerEscalating.status);

    const escalated = await buyer.post(`/api/orders/returns/${returnId}/escalate`, {});
    t.check(escalated.status === 200 && escalated.json.status === "ESCALATED",
      "the buyer escalates", `${escalated.status} ${escalated.json?.status}`);

    const twice = await buyer.post(`/api/orders/returns/${returnId}/escalate`, {});
    t.check(twice.status === 409, "escalating twice does nothing", twice.status);

    const sellerLockedOut = await seller.post(`/api/seller/returns/${returnId}/respond`, {
      approve: true,
    });
    t.check(sellerLockedOut.status === 409 && sellerLockedOut.json.code === "WRONG_STATE",
      "and the seller can no longer answer it — it is with a moderator",
      `${sellerLockedOut.status} ${sellerLockedOut.json?.code}`);

    /* ============================================================ *
     * 6. A moderator settles it, and money moves.
     * ============================================================ */
    t.section("6. the moderator approves, and the refund is real");

    const beforeRefunds = await prisma.refund.count({
      where: { orderItemId: sale.id },
    });
    t.check(beforeRefunds === 0, "no refund exists yet", beforeRefunds);

    /**
     * Approved directly through the library rather than through the admin
     * panel: the panel is behind a TOTP step-up that `admin.ts` already covers
     * end to end, and re-driving it here would test the step-up twice and the
     * return path once. What matters is that an approval produces a real
     * refund with the right trigger.
     */
    const { approveReturn } = await import("../../src/lib/returns");
    const moderatorId = await prisma.user
      .findFirstOrThrow({ where: { email: scope.emailFor("buyer") }, select: { id: true } })
      .then((u) => u.id);

    const settled = await approveReturn({
      id: returnId,
      decidedById: moderatorId,
      note: "Photo is ambiguous. Refunding.",
      allowEscalated: true,
    });
    t.check(settled.done === true, "the escalation is approved",
      settled.done ? settled.status : settled.reason);

    const refund = await prisma.refund.findFirst({
      where: { orderItemId: sale.id },
      select: { amountCents: true, trigger: true, status: true, reason: true },
    });
    t.check(!!refund, "a refund row now exists");
    t.check(refund?.amountCents === 6_400, "for the whole line", refund?.amountCents);
    t.check(refund?.trigger === RefundTrigger.BUYER_RETURN,
      "attributed to a buyer return, not to an admin acting alone", refund?.trigger);
    t.check(
      refund?.status === RefundStatus.SUCCEEDED || refund?.status === RefundStatus.PENDING,
      "and it reached the provider", refund?.status
    );
    t.check(refund?.reason.includes("chip on the rim") === true,
      "the buyer's own words reached the refund, so the reason they see is the reason they gave",
      refund?.reason);

    const linked = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: returnId },
      select: { status: true, refundId: true },
    });
    t.check(linked.status === ReturnStatus.APPROVED, "the request is APPROVED", linked.status);
    t.check(linked.refundId !== null, "and points at the refund it produced", linked.refundId);

    /**
     * The over-refund guard is the reason this cannot be done twice, and it is
     * `Order.refundedCents` doing the work rather than anything in the return
     * code. Worth asserting here because approval is now a second route into
     * money moving.
     */
    const secondAttempt = await approveReturn({
      id: returnId,
      decidedById: moderatorId,
      allowEscalated: true,
    });
    t.check(!secondAttempt.done && secondAttempt.reason === "wrong-state",
      "approving an approved request does nothing",
      secondAttempt.done ? "done" : secondAttempt.reason);
    t.check((await prisma.refund.count({ where: { orderItemId: sale.id } })) === 1,
      "and exactly one refund exists for the line");

    /* ---- the line is now unreturnable, and says why truthfully ---- */
    const after = await buyer.get(`/api/orders/items/${sale.id}/return`);
    t.check(after.json.eligible === false, "the line cannot be returned again",
      JSON.stringify(after.json));
    /**
     * ALREADY_REFUNDED, not ORDER_NOT_PAID. A full refund flips the order to
     * REFUNDED, and the first version of this check reported that as "never
     * paid" — to the one person who had definitely paid and definitely been
     * refunded. This assertion exists to keep the message honest.
     */
    t.check(after.json.code === "ALREADY_REFUNDED",
      "and says it was refunded rather than claiming it was never paid",
      after.json?.code);
  },

  async () => {
    const ids = (
      await prisma.order.findMany({
        where: { buyer: { email: { in: [scope.emailFor("buyer"), scope.emailFor("stranger")] } } },
        select: { id: true },
      })
    ).map((o) => o.id);
    if (ids.length > 0) {
      await prisma.returnRequest.deleteMany({ where: { orderId: { in: ids } } });
    }
    await scope.cleanup();
  }
);

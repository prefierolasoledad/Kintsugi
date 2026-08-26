import { Router, raw } from "express";
import type Stripe from "stripe";
import { OrderStatus } from "../generated/prisma/enums";
import {
  findOrderByIntentId,
  markOrderPaid,
  releaseOrder,
} from "../lib/orders";
import {
  PAYMENT_EVENTS,
  REFUND_EVENTS,
  readPaymentEvent,
  readRefundEvent,
} from "../lib/paymentProvider";
import { settleRefundFromProvider } from "../lib/refunds";
import { interpret } from "../lib/kycProvider";
import { StripeConfigError, verifyStripeWebhook } from "../lib/stripeClient";
import { applyDecision, cancelAttempt } from "../lib/verification";

export const webhooksRouter = Router();

/**
 * Stripe webhooks — payments and identity, one endpoint.
 *
 * In a real browser flow this endpoint, not the request the user made, is the
 * source of truth. The buyer confirms a payment with Stripe.js and the browser
 * may then close; the seller finishes an identity check on Stripe's own domain
 * and may never come back. Either way the outcome is real, and this is how we
 * hear about it.
 *
 * FOUR THINGS THIS HAS TO GET RIGHT
 *
 * 1. RAW BODY. Stripe signs the exact bytes it sent. Parsing to JSON and
 *    re-serialising changes them and every signature fails. Hence the raw
 *    parser here, mounted before the app-wide express.json().
 *
 * 2. SIGNATURE VERIFICATION. Without it this is an unauthenticated
 *    "mark my order paid" *and* "mark this seller verified" endpoint that
 *    anyone on the internet can call. An unverified body is never read.
 *
 * 3. IDEMPOTENCY. Stripe delivers at least once and retries on any non-2xx, so
 *    duplicates are normal traffic rather than an error case. Both handlers
 *    below early-return on an already-settled record.
 *
 * 4. ANSWER FAST, AND ANSWER 200 FOR ANYTHING WE WON'T RETRY. Stripe treats a
 *    non-2xx as "try again later", so returning 500 for an event we simply do
 *    not recognise buys an infinite retry loop. Unknown events are
 *    acknowledged. A genuine internal failure does return 500 — there, a retry
 *    is exactly what we want.
 *
 * Local testing: `stripe listen --forward-to localhost:4000/webhooks/stripe`
 * prints the signing secret to put in STRIPE_WEBHOOK_SECRET.
 */
webhooksRouter.post(
  "/stripe",
  raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    let event: Stripe.Event;
    try {
      event = verifyStripeWebhook(req.body as Buffer, req.header("stripe-signature"));
    } catch (err) {
      const message =
        err instanceof StripeConfigError ? err.message : "Invalid webhook.";
      // 400, not 500: the payload is bad, so retrying it changes nothing.
      return res.status(400).json({ error: message });
    }

    try {
      if (PAYMENT_EVENTS.includes(event.type)) {
        return await handlePayment(event, res);
      }
      if (REFUND_EVENTS.includes(event.type)) {
        return await handleRefund(event, res);
      }
      if (event.type.startsWith("identity.verification_session.")) {
        return await handleIdentity(event, res);
      }

      // Not ours. Acknowledged so Stripe stops resending it.
      return res.status(200).json({ received: true, ignored: event.type });
    } catch (err) {
      // A real failure on our side. 500 asks Stripe to redeliver, which is
      // right — the event is valid and we failed to apply it.
      console.error(`Failed to apply webhook ${event.id} (${event.type})`, err);
      return res.status(500).json({ error: "Could not process that event." });
    }
  }
);

async function handlePayment(event: Stripe.Event, res: import("express").Response) {
  const parsed = readPaymentEvent(event);
  if (!parsed.outcome || !parsed.intentId) {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const order = await findOrderByIntentId(parsed.intentId);
  if (!order) {
    // Test-mode noise, or an intent from another environment sharing the
    // account. Retrying will not conjure the order.
    console.warn(`Webhook ${event.type} for unknown intent ${parsed.intentId}`);
    return res.status(200).json({ received: true, ignored: "unknown_intent" });
  }

  if (parsed.outcome.status === "succeeded") {
    await markOrderPaid(order.id);
  } else {
    await releaseOrder(order.id, OrderStatus.FAILED, parsed.outcome.reason);
  }

  return res.status(200).json({ received: true });
}

/**
 * Refund results.
 *
 * Most refunds settle inside the original request — Stripe answers immediately
 * in test mode — and this endpoint then has nothing to do. It exists for the
 * ones that do not: a refund can come back `pending` and be decided minutes
 * later, and without this the row would stay PENDING for ever, with the buyer
 * told their money was on its way and the headroom held against the order.
 *
 * A refusal matters as much as a success here. The headroom reserved when the
 * refund was requested has to be released, or the order permanently believes
 * money went out that never did.
 */
async function handleRefund(event: Stripe.Event, res: import("express").Response) {
  const parsed = readRefundEvent(event);
  if (!parsed.outcome || !parsed.refundId) {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const applied = await settleRefundFromProvider({
    providerRefundId: parsed.refundId,
    outcome: parsed.outcome,
  });

  if (!applied.applied) {
    /**
     * None of these is an error, and none should be retried.
     *
     * NOT_FOUND      a refund from another environment sharing this account.
     * ALREADY_SETTLED the synchronous path, or an earlier delivery, got there
     *                 first — the idempotency guarantee working.
     * STILL_PENDING   Stripe telling us it is still thinking.
     */
    if (applied.reason === "NOT_FOUND") {
      console.warn(`Refund webhook for unknown refund ${parsed.refundId}`);
    }
    return res.status(200).json({ received: true, ignored: applied.reason });
  }

  console.log(`Refund ${applied.refundId} settled as ${applied.status} via ${event.type}`);
  return res.status(200).json({ received: true, status: applied.status });
}

/**
 * Identity results.
 *
 * `verified` and `requires_input` are the two that matter. Note that
 * requires_input is Stripe's state for BOTH "hasn't started" and "was
 * refused" — interpret() in kycProvider.ts uses last_error to tell them
 * apart, so a fresh session doesn't get recorded as a rejection.
 */
async function handleIdentity(event: Stripe.Event, res: import("express").Response) {
  const session = event.data.object as Stripe.Identity.VerificationSession;
  const state = interpret(session);

  if (state.state === "PENDING") {
    // Nothing decided yet. Acknowledged, not retried.
    return res.status(200).json({ received: true, ignored: `${event.type}:pending` });
  }

  if (state.state === "CANCELLED") {
    const closed = await cancelAttempt(session.id);
    return res.status(200).json({ received: true, cancelled: closed });
  }

  const applied = await applyDecision({
    providerSessionId: session.id,
    decision: state.decision,
  });

  if (!applied.applied) {
    /**
     * NOT_FOUND means the session belongs to another environment sharing this
     * Stripe account — a 500 would have Stripe retry it forever.
     * ALREADY_DECIDED means the poll on the return page got there first, which
     * is the idempotency guarantee working, not a problem.
     */
    if (applied.reason === "NOT_FOUND") {
      console.warn(`Identity webhook for unknown session ${session.id}`);
    }
    return res.status(200).json({ received: true, ignored: applied.reason });
  }

  console.log(
    `Identity ${applied.verified ? "verified" : "rejected"} for seller ${applied.sellerProfileId}` +
      ` (payouts ${applied.verified ? "enabled" : "still locked"})`
  );
  return res.status(200).json({ received: true, verified: applied.verified });
}

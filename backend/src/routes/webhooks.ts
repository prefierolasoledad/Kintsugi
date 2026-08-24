import { Router, raw } from "express";
import { OrderStatus } from "../generated/prisma/enums";
import {
  findOrderByIntentId,
  markOrderPaid,
  releaseOrder,
} from "../lib/orders";
import { PaymentError, verifyWebhook } from "../lib/paymentProvider";

export const webhooksRouter = Router();

/**
 * Stripe webhooks.
 *
 * In a real browser flow this endpoint — not the pay route — is the source of
 * truth. The client confirms the payment with Stripe.js and the browser may
 * then close, lose connection, or never come back; the money still moved, and
 * this is how we hear about it.
 *
 * FOUR THINGS THIS HAS TO GET RIGHT
 *
 * 1. RAW BODY. Stripe signs the exact bytes it sent. Parsing to JSON and
 *    re-serialising changes them and every signature fails. Hence the raw
 *    parser here, mounted before the app-wide express.json().
 *
 * 2. SIGNATURE VERIFICATION. Without it this is an unauthenticated
 *    "mark my order paid" endpoint that anyone on the internet can call.
 *    This is the entire security model, so an unverified body is never read.
 *
 * 3. IDEMPOTENCY. Stripe delivers at least once and retries on any non-2xx,
 *    so duplicates are normal traffic rather than an error case. markOrderPaid
 *    early-returns on an already-paid order, which makes a redelivery a no-op
 *    instead of a second round of side effects.
 *
 * 4. ANSWER FAST, AND ANSWER 200 FOR ANYTHING WE WON'T RETRY. Stripe treats a
 *    non-2xx as "try again later". Returning 500 for an event we simply don't
 *    recognise buys an infinite retry loop, so unknown events are acknowledged.
 *    A genuine internal failure does return 500 — there, a retry is what we
 *    want.
 *
 * Local testing: `stripe listen --forward-to localhost:4000/webhooks/stripe`
 * prints the signing secret to put in STRIPE_WEBHOOK_SECRET.
 */
webhooksRouter.post(
  "/stripe",
  raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    let event;
    try {
      event = verifyWebhook(req.body as Buffer, req.header("stripe-signature"));
    } catch (err) {
      const message = err instanceof PaymentError ? err.message : "Invalid webhook.";
      // 400, not 500: the payload is bad, so retrying it changes nothing.
      return res.status(400).json({ error: message });
    }

    // Not an event we act on. Acknowledged so Stripe stops resending it.
    if (!event.outcome || !event.intentId) {
      return res.status(200).json({ received: true, ignored: event.type });
    }

    try {
      const order = await findOrderByIntentId(event.intentId);
      if (!order) {
        // Test-mode noise, or an intent from another environment sharing the
        // account. Nothing to do, and retrying will not conjure the order.
        console.warn(`Webhook ${event.type} for unknown intent ${event.intentId}`);
        return res.status(200).json({ received: true, ignored: "unknown_intent" });
      }

      if (event.outcome.status === "succeeded") {
        await markOrderPaid(order.id);
      } else {
        await releaseOrder(order.id, OrderStatus.FAILED, event.outcome.reason);
      }

      res.status(200).json({ received: true });
    } catch (err) {
      // A real failure on our side. 500 asks Stripe to redeliver, which is
      // exactly right — the event is valid and we failed to apply it.
      console.error(`Failed to apply webhook ${event.id} (${event.type})`, err);
      res.status(500).json({ error: "Could not process that event." });
    }
  }
);

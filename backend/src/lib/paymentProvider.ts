import crypto from "crypto";
import Stripe from "stripe";

/**
 * Payment provider.
 *
 * WHY THIS IS A SEAM
 * Card details must never reach this application. PCI scope is enormous and
 * entirely avoidable: the provider collects the card, we hold a reference to
 * the resulting payment. Same reasoning as lib/kycProvider.ts — the sensitive
 * thing stays with the party built to hold it.
 *
 * TWO ADAPTERS, ONE INTERFACE
 *   stub   — no account needed, deterministic outcomes, in-process state.
 *   stripe — real Stripe test mode / sandbox, driven by test payment methods.
 * Both are state machines, and that is the point: an intent that has already
 * succeeded cannot succeed again in either mode, so the code above behaves the
 * same way whichever is configured.
 *
 * The interface follows Stripe's PaymentIntents because that is what it wraps:
 *   createIntent()  ~ stripe.paymentIntents.create()
 *   confirmIntent() ~ stripe.paymentIntents.confirm()
 *   getIntent()     ~ stripe.paymentIntents.retrieve()  (used to reconcile)
 *   verifyWebhook() ~ stripe.webhooks.constructEvent()
 *
 * IDEMPOTENCY
 * Every mutating call takes an idempotencyKey. This is the layer that survives
 * what a lock cannot: if we send a request, Stripe charges the card, and the
 * response is lost to a timeout or a restart, we do not know whether money
 * moved. Retrying with the same key returns Stripe's original result instead of
 * charging a second time. Keys must therefore be derived from stable data — the
 * order id — never randomly generated per attempt, which would protect nothing.
 * Stripe retains keys for 24 hours.
 *
 * PAYMENT_PROVIDER=stub is the default so development needs no account. Stripe
 * signup is invite-only in some countries, so an account cannot be assumed.
 */

/**
 * Reads a configuration value, trimming it and treating blank as unset.
 *
 * Trimming is not fussiness. A key pasted into .env with a stray leading space
 * — `STRIPE_WEBHOOK_SECRET=" whsec_..."` — is truthy, so every "is it set"
 * check passes, and the failure surfaces much later as an unexplained
 * signature mismatch on every webhook. Copy-paste whitespace is the single most
 * likely way this file gets misconfigured, so it is handled once, here, rather
 * than debugged repeatedly.
 */
function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export const PAYMENT_PROVIDER = env("PAYMENT_PROVIDER") ?? "stub";

/** Mirrors the subset of Stripe's PaymentIntent statuses we act on. */
export type IntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  /** Authorised but not captured. Money is committed, so never "failed". */
  | "requires_capture"
  | "processing"
  | "succeeded"
  | "canceled";

export type PaymentIntent = {
  /** Provider-side id. The only payment identifier we store. */
  id: string;
  /** What a real client would use to confirm the payment in the browser. */
  clientSecret: string | null;
  amountCents: number;
  currency: string;
};

export type PaymentOutcome =
  /** Money moved. Terminal. */
  | { status: "succeeded"; intentId: string }
  /** Definitively refused. No money moved. Terminal. */
  | { status: "failed"; intentId: string; reason: string }
  /** Not resolved yet — 3-D Secure, or an async method. Not terminal. */
  | { status: "pending"; intentId: string; reason: string };

export class PaymentError extends Error {
  /** True when we genuinely do not know whether the card was charged. */
  indeterminate: boolean;

  constructor(message: string, indeterminate = false) {
    super(message);
    this.name = "PaymentError";
    this.indeterminate = indeterminate;
  }
}

export function isStubProvider() {
  return PAYMENT_PROVIDER === "stub";
}

/**
 * True when no real money can move.
 *
 * The UI needs this to label the payment form honestly. "Provider is stripe" is
 * not enough to decide — Stripe test mode and live mode are the same provider,
 * and the difference is the key. Getting this wrong in either direction is bad:
 * telling someone their money is safe when it is live, or nagging about a
 * sandbox on a real checkout.
 */
export function isTestMode(): boolean {
  if (PAYMENT_PROVIDER === "stub") return true;
  const key = env("STRIPE_SECRET_KEY") ?? "";
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

/**
 * Validates payment configuration at boot.
 *
 * Called before the server accepts traffic, because the alternative is
 * discovering a missing key when a buyer is halfway through checkout. A
 * configuration mistake should stop the process, not one customer.
 *
 * Returns a human-readable summary for the startup log.
 */
export function assertProviderConfigured(): string {
  if (PAYMENT_PROVIDER === "stub") {
    return "stub (no account needed; intents are in-process and lost on restart)";
  }

  if (PAYMENT_PROVIDER !== "stripe") {
    throw new Error(
      `PAYMENT_PROVIDER="${PAYMENT_PROVIDER}" is not a known provider. ` +
        `Use "stub" or "stripe", or add an adapter in src/lib/paymentProvider.ts.`
    );
  }

  const key = env("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error(
      'PAYMENT_PROVIDER="stripe" requires STRIPE_SECRET_KEY. ' +
        "Get a test key from the Stripe dashboard (Developers > API keys, test mode on), " +
        'or set PAYMENT_PROVIDER="stub" to run without an account.'
    );
  }
  if (key.startsWith("pk_")) {
    // Easy mistake, and it fails confusingly much later otherwise.
    throw new Error(
      "STRIPE_SECRET_KEY holds a publishable key (pk_...). The secret key begins sk_test_."
    );
  }
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "STRIPE_SECRET_KEY is not a test key. Refusing to start outside production — " +
          "a live key here would take real money during development."
      );
    }
  }

  const whsec = env("STRIPE_WEBHOOK_SECRET");
  if (!whsec) {
    // Not optional: the webhook is the source of truth for a browser-confirmed
    // payment, and without the signing secret it cannot be trusted at all.
    throw new Error(
      'PAYMENT_PROVIDER="stripe" requires STRIPE_WEBHOOK_SECRET. Run ' +
        "`stripe listen --forward-to localhost:4000/webhooks/stripe` and use the " +
        "whsec_... value it prints."
    );
  }
  if (!whsec.startsWith("whsec_")) {
    // Almost always a secret key pasted into the wrong slot, or a truncated
    // copy. Caught here because the alternative is every webhook silently
    // failing its signature check with nothing pointing at the cause.
    throw new Error(
      `STRIPE_WEBHOOK_SECRET does not look like a signing secret (expected whsec_..., got "${whsec.slice(0, 8)}...").`
    );
  }

  const mode = key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : "LIVE";
  return `stripe (${mode} mode, webhooks verified)`;
}

/* ------------------------------------------------------------------ *
 * Test card numbers
 *
 * Both adapters key off the last four digits, using Stripe's documented
 * test numbers so the same input produces the same outcome in either mode.
 * The number itself is never stored, logged, or sent anywhere — in Stripe
 * mode it is mapped to a test payment-method token before the API call, so
 * even a real card typed in by mistake never leaves this process.
 * ------------------------------------------------------------------ */

const OUTCOME_BY_LAST4: Record<string, { reason: string; stripePm: string }> = {
  // 4000 0000 0000 0002 — generic decline
  "0002": { reason: "Your card was declined.", stripePm: "pm_card_chargeDeclined" },
  // 4000 0000 0000 0069 — expired card
  "0069": { reason: "That card has expired.", stripePm: "pm_card_chargeDeclinedExpiredCard" },
  // 4000 0000 0000 0119 — processing error
  "0119": {
    reason: "The payment couldn't be processed. Try again.",
    stripePm: "pm_card_chargeDeclinedProcessingError",
  },
  // 4000 0025 0000 3155 — requires authentication (3-D Secure)
  "3155": { reason: "That card needs extra authentication.", stripePm: "pm_card_authenticationRequired" },
};

/** Rejects malformed input before anything is claimed or charged. */
export function normaliseCardNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 12 || digits.length > 19) {
    throw new PaymentError("That doesn't look like a card number.");
  }
  return digits;
}

/* ------------------------------------------------------------------ *
 * Stub adapter
 * ------------------------------------------------------------------ */

type StubIntent = {
  id: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  status: IntentStatus;
  reason: string | null;
};

/**
 * In-process intent store.
 *
 * Deliberately a state machine rather than a pure function: a pure
 * confirmIntent() would return "succeeded" every time it was called, which
 * would quietly hide double-charge bugs in the layers above instead of
 * exposing them. Restarting the process forgets everything, which is correct
 * for a development stub and is exactly why it is not a production path.
 */
const stubIntents = new Map<string, StubIntent>();

/** Keyed replies, so a retried call returns its first result. */
const stubIdempotency = new Map<string, string>();

/* ------------------------------------------------------------------ *
 * Stripe adapter
 * ------------------------------------------------------------------ */

let stripeClient: Stripe | null = null;

function stripe(): Stripe {
  if (!stripeClient) {
    const key = env("STRIPE_SECRET_KEY");
    if (!key) {
      throw new PaymentError(
        'PAYMENT_PROVIDER="stripe" needs STRIPE_SECRET_KEY. Use a test-mode key ' +
          "(sk_test_…); a live key is refused below."
      );
    }
    if (!key.startsWith("sk_test_") && process.env.NODE_ENV !== "production") {
      // A live key outside production would take real money during testing.
      throw new PaymentError(
        "STRIPE_SECRET_KEY is not a test key. Refusing to start outside production."
      );
    }
    stripeClient = new Stripe(key, {
      // Pinned: an unpinned version means Stripe can change response shapes
      // under a running deployment.
      apiVersion: "2026-07-29.dahlia",
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Kintsugi", url: "https://github.com/prefierolasoledad/Kintsugi" },
    });
  }
  return stripeClient;
}

function assertKnownProvider() {
  if (PAYMENT_PROVIDER !== "stub" && PAYMENT_PROVIDER !== "stripe") {
    throw new PaymentError(
      `PAYMENT_PROVIDER="${PAYMENT_PROVIDER}" is not implemented. Add the adapter here.`
    );
  }
}

/**
 * A network error on a mutating Stripe call is indeterminate: the request may
 * have reached Stripe and charged the card before the connection died. Callers
 * must not treat it as a failure and must not retry without the same key.
 */
function translateStripeError(err: unknown, mutating: boolean): never {
  if (err instanceof Stripe.errors.StripeCardError) {
    // A card error is a definitive refusal — no money moved.
    throw new PaymentError(err.message || "Your card was declined.", false);
  }
  if (
    err instanceof Stripe.errors.StripeConnectionError ||
    err instanceof Stripe.errors.StripeAPIError
  ) {
    throw new PaymentError(
      "We couldn't reach the payment provider. Your payment is being verified.",
      mutating
    );
  }
  if (err instanceof Stripe.errors.StripeError) {
    throw new PaymentError(err.message || "The payment provider rejected that request.", false);
  }
  throw err;
}

/* ------------------------------------------------------------------ *
 * Public interface
 * ------------------------------------------------------------------ */

export async function createIntent(input: {
  amountCents: number;
  currency: string;
  orderReference: string;
  /** Must be stable for this order. See the IDEMPOTENCY note above. */
  idempotencyKey: string;
}): Promise<PaymentIntent> {
  assertKnownProvider();

  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw new PaymentError("Payment amount must be a positive whole number of minor units.");
  }

  if (PAYMENT_PROVIDER === "stub") {
    const existingId = stubIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = stubIntents.get(existingId)!;
      return {
        id: existing.id,
        clientSecret: existing.clientSecret,
        amountCents: existing.amountCents,
        currency: existing.currency,
      };
    }

    const id = `pi_stub_${crypto.randomBytes(12).toString("hex")}`;
    const intent: StubIntent = {
      id,
      // A real client secret authorises confirming exactly one intent. This is
      // a stand-in with the same shape and is not a credential for anything.
      clientSecret: `${id}_secret_${crypto.randomBytes(8).toString("hex")}`,
      amountCents: input.amountCents,
      currency: input.currency,
      status: "requires_confirmation",
      reason: null,
    };
    stubIntents.set(id, intent);
    stubIdempotency.set(input.idempotencyKey, id);
    return {
      id,
      clientSecret: intent.clientSecret,
      amountCents: intent.amountCents,
      currency: intent.currency,
    };
  }

  try {
    const intent = await stripe().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency.toLowerCase(),
        payment_method_types: ["card"],
        // Metadata is for humans reading the Stripe dashboard during support.
        // Stripe does not interpret it, and it must never carry anything
        // sensitive — it is visible to anyone with dashboard access.
        metadata: { orderReference: input.orderReference },
        description: `Kintsugi order ${input.orderReference}`,
      },
      { idempotencyKey: input.idempotencyKey }
    );

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      currency: intent.currency.toUpperCase(),
    };
  } catch (err) {
    translateStripeError(err, true);
  }
}

/**
 * Resolves a payment.
 *
 * With a real provider in a browser flow the client confirms and the result
 * arrives as a signed webhook. Confirming here as well is how sandbox testing
 * works without a browser: Stripe accepts test payment-method tokens on a
 * server-side confirm, which is exactly what the card mapping produces.
 *
 * Deterministic outcomes in both modes, by last four digits:
 *   0002 -> declined   0069 -> expired   0119 -> processing error
 *   3155 -> needs authentication (pending, not failed)
 *   anything else -> succeeds
 */
export async function confirmIntent(input: {
  intentId: string;
  cardNumber: string;
  idempotencyKey: string;
}): Promise<PaymentOutcome> {
  assertKnownProvider();

  const digits = normaliseCardNumber(input.cardNumber);
  const scripted = OUTCOME_BY_LAST4[digits.slice(-4)];

  if (PAYMENT_PROVIDER === "stub") {
    const intent = stubIntents.get(input.intentId);
    if (!intent) {
      throw new PaymentError("Unknown payment intent.");
    }

    // The state machine, mirroring Stripe: a resolved intent stays resolved.
    if (intent.status === "succeeded") {
      return { status: "succeeded", intentId: intent.id };
    }
    if (intent.status === "canceled") {
      return {
        status: "failed",
        intentId: intent.id,
        reason: intent.reason ?? "That payment was cancelled.",
      };
    }
    if (intent.status === "requires_action") {
      return {
        status: "pending",
        intentId: intent.id,
        reason: intent.reason ?? "That card needs extra authentication.",
      };
    }

    if (!scripted) {
      intent.status = "succeeded";
      return { status: "succeeded", intentId: intent.id };
    }
    if (digits.slice(-4) === "3155") {
      intent.status = "requires_action";
      intent.reason = scripted.reason;
      return { status: "pending", intentId: intent.id, reason: scripted.reason };
    }
    // requires_payment_method is Stripe's post-decline state: the intent stays
    // usable so the buyer can try a different card.
    intent.status = "requires_payment_method";
    intent.reason = scripted.reason;
    return { status: "failed", intentId: intent.id, reason: scripted.reason };
  }

  // Never send the digits themselves. Stripe's test tokens stand in for a card
  // collected by Stripe.js, so no card data crosses this boundary even in test
  // mode — the same contract that must hold in production.
  const paymentMethod = scripted ? scripted.stripePm : "pm_card_visa";

  try {
    const intent = await stripe().paymentIntents.confirm(
      input.intentId,
      {
        payment_method: paymentMethod,
        // Required when a payment method might redirect. Nothing in the test
        // set does, but Stripe rejects the call without it.
        return_url: `${env("FRONTEND_ORIGIN") ?? "http://localhost:3000"}/orders/return`,
      },
      { idempotencyKey: input.idempotencyKey }
    );

    return intentToOutcome(intent);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      return {
        status: "failed",
        intentId: input.intentId,
        reason: err.message || "Your card was declined.",
      };
    }
    translateStripeError(err, true);
  }
}

function intentToOutcome(intent: Stripe.PaymentIntent): PaymentOutcome {
  switch (intent.status) {
    case "succeeded":
      return { status: "succeeded", intentId: intent.id };
    case "requires_action":
    case "processing":
    // Authorised, awaiting capture. Money is committed, so this is emphatically
    // not a failure — treating it as one would return stock for a paid item.
    case "requires_capture":
      return {
        status: "pending",
        intentId: intent.id,
        reason:
          intent.status === "requires_action"
            ? "That card needs extra authentication."
            : "That payment is still being processed.",
      };
    case "canceled":
      return { status: "failed", intentId: intent.id, reason: "That payment was cancelled." };
    default:
      return {
        status: "failed",
        intentId: intent.id,
        reason:
          intent.last_payment_error?.message ??
          "The payment didn't complete. Try a different card.",
      };
  }
}

/**
 * Asks the provider what actually happened.
 *
 * This is the escape hatch for the one state we cannot resolve locally: an
 * order left mid-payment by a crash or a lost response. The provider is the
 * only authority on whether money moved, so reconciliation has to ask rather
 * than guess — guessing means either charging twice or losing a payment.
 */
export async function getIntent(
  intentId: string
): Promise<{ id: string; status: IntentStatus; outcome: PaymentOutcome } | null> {
  assertKnownProvider();

  if (PAYMENT_PROVIDER === "stub") {
    const intent = stubIntents.get(intentId);
    if (!intent) return null;
    return {
      id: intent.id,
      status: intent.status,
      outcome:
        intent.status === "succeeded"
          ? { status: "succeeded", intentId: intent.id }
          : intent.status === "requires_action" || intent.status === "processing"
            ? {
                status: "pending",
                intentId: intent.id,
                reason: intent.reason ?? "Still processing.",
              }
            : {
                status: "failed",
                intentId: intent.id,
                reason: intent.reason ?? "The payment didn't complete.",
              },
    };
  }

  try {
    const intent = await stripe().paymentIntents.retrieve(intentId);
    return { id: intent.id, status: intent.status, outcome: intentToOutcome(intent) };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) return null;
    // Reads are safe to report as indeterminate=false: nothing was mutated.
    translateStripeError(err, false);
  }
}

/**
 * Cancels an intent that was never completed.
 *
 * Needed because releasing stock is not enough on its own: an abandoned
 * 3-D Secure prompt leaves a confirmable intent behind, and a buyer who
 * finishes it an hour later would pay for an item we had already put back on
 * sale. Cancelling at the provider closes that door before the stock reopens.
 */
export async function cancelIntent(input: {
  intentId: string;
  idempotencyKey: string;
}): Promise<void> {
  assertKnownProvider();

  if (PAYMENT_PROVIDER === "stub") {
    const intent = stubIntents.get(input.intentId);
    if (!intent) return;
    // Never cancel a payment that already went through.
    if (intent.status === "succeeded") return;
    intent.status = "canceled";
    intent.reason = "Payment wasn't completed in time.";
    return;
  }

  try {
    await stripe().paymentIntents.cancel(
      input.intentId,
      { cancellation_reason: "abandoned" },
      { idempotencyKey: input.idempotencyKey }
    );
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      // Already cancelled, already succeeded, or gone. Nothing left to do.
      return;
    }
    translateStripeError(err, false);
  }
}

export type PaymentEvent = {
  id: string;
  type: string;
  intentId: string;
  outcome: PaymentOutcome | null;
};

/**
 * Verifies and parses a provider webhook.
 *
 * The signature check is the whole security model here: without it this
 * endpoint is an unauthenticated "mark my order paid" button. Stripe signs the
 * raw bytes, so the body must not have been parsed or re-serialised before it
 * reaches this function.
 */
export function verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent {
  if (PAYMENT_PROVIDER !== "stripe") {
    throw new PaymentError("Webhooks are only supported with the Stripe adapter.");
  }
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new PaymentError("STRIPE_WEBHOOK_SECRET is not set; refusing to trust this webhook.");
  }
  if (!signature) {
    throw new PaymentError("Missing Stripe signature header.");
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    // Deliberately opaque: a caller probing this endpoint learns nothing about
    // why their forgery failed.
    throw new PaymentError("Invalid webhook signature.");
  }

  const relevant = [
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
  ];
  if (!relevant.includes(event.type)) {
    return { id: event.id, type: event.type, intentId: "", outcome: null };
  }

  const intent = event.data.object as Stripe.PaymentIntent;
  return {
    id: event.id,
    type: event.type,
    intentId: intent.id,
    outcome:
      event.type === "payment_intent.succeeded"
        ? { status: "succeeded", intentId: intent.id }
        : {
            status: "failed",
            intentId: intent.id,
            reason: intent.last_payment_error?.message ?? "The payment didn't complete.",
          },
  };
}

/** Test-only: lets the suite simulate a process restart losing stub state. */
export function __resetStubState() {
  stubIntents.clear();
  stubIdempotency.clear();
}

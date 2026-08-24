import { ApiError } from "@/lib/api";

/**
 * Orders and payment.
 *
 * The card number is passed to payOrder() and never stored, never put in
 * component state that outlives the request, and never sent anywhere except
 * this one call. See docs/adr/0013-payment-provider-seam.md.
 */

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED";

export type OrderItem = {
  id: string;
  /** Snapshotted at purchase, so it says what was bought even if the seller renames it. */
  title: string;
  unitPriceCents: number;
  quantity: number;
  sellerName: string;
  slug: string | null;
  image: string | null;
};

export type Order = {
  id: string;
  /** Short, speakable reference for support conversations. */
  reference: string;
  status: OrderStatus;
  subtotalCents: number;
  currency: string;
  paymentProvider: string | null;
  /** True when no real money can move. Decided by the API, not guessed here. */
  testMode: boolean;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
  items: OrderItem[];
};

export type PaymentOutcome = "succeeded" | "failed" | "pending";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/orders${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      body.error ?? "Something went wrong. Please try again.",
      body.code,
      body.field
    );
  }

  return body as T;
}

export function getMyOrders() {
  return request<{ orders: Order[] }>("");
}

export function getOrder(orderId: string) {
  return request<{ order: Order }>(`/${orderId}`);
}

/** Converts the buyer's live holds into an order and opens a payment for it. */
export function startCheckout() {
  return request<{
    order: Order;
    payment: {
      intentId: string;
      clientSecret: string | null;
      amountCents: number;
      currency: string;
      isStub: boolean;
    };
  }>("", { method: "POST" });
}

export function payOrder(orderId: string, cardNumber: string) {
  return request<{
    outcome: PaymentOutcome;
    reason: string | null;
    order: Order;
  }>(`/${orderId}/pay`, {
    method: "POST",
    body: JSON.stringify({ cardNumber }),
  });
}

export function cancelOrder(orderId: string) {
  return request<{ order: Order }>(`/${orderId}/cancel`, { method: "POST" });
}

/** An order still holding stock, so it can be resumed or cancelled. */
export function isOpen(order: Order) {
  return order.status === "PENDING_PAYMENT" || order.status === "PROCESSING";
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PROCESSING: "Payment in progress",
  PAID: "Paid",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/**
 * Test cards, offered as one-tap fills on the payment form.
 *
 * Same numbers work against the stub and against Stripe test mode — in Stripe
 * mode the API maps them to test payment-method tokens, so no card number ever
 * reaches Stripe.
 */
export const TEST_CARDS = [
  { number: "4242424242424242", label: "Succeeds" },
  { number: "4000000000000002", label: "Declined" },
  { number: "4000000000000069", label: "Expired card" },
  { number: "4000002500003155", label: "Needs authentication" },
] as const;

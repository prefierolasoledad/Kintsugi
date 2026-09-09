import { ApiError } from "@/lib/api";

export type AdminSession = {
  isAdmin: boolean;
  needsTotpSetup: boolean;
  active: boolean;
  expiresInSeconds: number;
};

export type Report = {
  id: string;
  targetType: "LISTING" | "USER" | "REVIEW";
  targetId: string;
  targetLabel: string;
  reason: string;
  detail: string | null;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** The reporter's name only — a queue does not need contact details. */
  reporterName: string;
};

export type ModerationAction = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string;
  reportId: string | null;
  createdAt: string;
  moderator: string;
  moderatorEmail: string;
};

export type Overview = {
  reports: { open: number; resolved: number; dismissed: number };
  catalogue: { total: number; active: number };
  accounts: { total: number; suspended: number };
  orders: { total: number; paid: number };
};

/* ---- dashboard ---- */

export type Range = 7 | 30 | 90;

export type OrderStatus =
  | "PENDING_PAYMENT"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  /** Fully refunded. A PARTLY refunded order stays PAID. */
  | "REFUNDED";

export type Metrics = {
  days: Range;
  grossCents: number;
  orders: number;
  buyers: number;
  aovCents: number;
  newUsers: number;
  /** Money sent back in the period. Reported beside gross, not netted off it. */
  refundedCents: number;
  /** Null when the prior period had nothing to compare against. */
  deltas: {
    gross: number | null;
    orders: number | null;
    aov: number | null;
    newUsers: number | null;
    refunded: number | null;
  };
  series: Array<{ date: string; grossCents: number; orders: number }>;
  attention: {
    openReports: number;
    unfulfilledOver3Days: number;
    stuckPayments: number;
    failedPayments: number;
    rejectedKyc: number;
  };
  topSellers: Array<{
    sellerId: string;
    shopName: string;
    userId: string;
    grossCents: number;
    units: number;
  }>;
  recentOrders: OrderRow[];
};

export type OrderRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  subtotalCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  lines: number;
  units: number;
  fulfilledLines: number;
};

export type OrderDetail = {
  id: string;
  reference: string;
  status: OrderStatus;
  subtotalCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
  paymentProvider: string | null;
  paymentIntentId: string | null;
  buyer: {
    id: string;
    name: string;
    email: string;
    createdAt: string;
    suspendedAt: string | null;
  };
  shipTo: {
    name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unitPriceCents: number;
    sellerName: string;
    sellerUserId: string | null;
    fulfilment: "UNFULFILLED" | "SHIPPED" | "DELIVERED" | "UNFULFILLABLE";
    carrier: string | null;
    trackingNumber: string | null;
    fulfilmentNote: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    listingId: string | null;
    listingSlug: string | null;
    listingGone: boolean;
  }>;
  refunds: AdminRefund[];
  /** What is still refundable, in minor units. Computed server-side. */
  refundableCents: number;
};

export type AdminRefund = {
  id: string;
  orderItemId: string | null;
  amountCents: number;
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  trigger: "SELLER_UNFULFILLABLE" | "ADMIN";
  reason: string;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  isSeller: boolean;
  emailVerified: boolean;
  role: "USER" | "ADMIN";
  suspendedAt: string | null;
  suspendedReason: string | null;
  orders: number;
};

export type CustomerDetail = Omit<CustomerRow, "orders"> & {
  avatarUrl: string | null;
  sellerProfile: {
    id: string;
    shopName: string;
    kycStatus: string;
    payoutsEnabled: boolean;
    _count: { listings: number; sales: number };
  } | null;
  lifetimeSpendCents: number;
  paidOrders: number;
  recentOrders: Array<{
    id: string;
    reference: string;
    status: OrderStatus;
    subtotalCents: number;
    createdAt: string;
  }>;
  reportsAgainst: number;
};

export type ListingRow = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  currency: string;
  quantity: number;
  status: "DRAFT" | "ACTIVE" | "RESERVED" | "SOLD" | "REMOVED";
  removed: boolean;
  createdAt: string;
  condition: string;
  sellerName: string;
  sellerUserId: string;
  category: string;
  image: string | null;
  reviews: number;
  sold: number;
};

export type DeliveryChannel = "EMAIL" | "PUSH" | "SMS";
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "SUPPRESSED" | "DEFERRED";

/**
 * One attempt to get one notification to one person on one channel.
 *
 * `recipient` is nullable because the ledger has no foreign key to `users` — a
 * delivery record has to outlive the account it was for, so an answer of "this
 * was sent to an account since deleted" is a real and useful one.
 *
 * There is no message body here, and there is not meant to be. The ledger
 * records that something was sent, not what it said.
 */
export type DeliveryRow = {
  id: string;
  eventId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  recipient: { id: string; email: string; name: string } | null;
  notification: { id: string; title: string; type: string } | null;
  providerMessageId: string | null;
  attempts: number;
  lastError: string | null;
  suppressReason: string | null;
  notBefore: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? "Something went wrong.", body.code, body.field);
  }
  return body as T;
}

/* ---- step-up ---- */

export function getAdminSession() {
  return request<AdminSession>("/session");
}

/**
 * 401 here means "no live admin session", which is the normal case.
 *
 * `secondsLeft` comes from the token's own expiry so the panel's countdown
 * matches what the server will actually enforce.
 */
export async function isAdminSessionActive(): Promise<{
  active: boolean;
  secondsLeft: number;
}> {
  try {
    const r = await request<{ active: true; secondsLeft: number }>("/session/active");
    return { active: true, secondsLeft: r.secondsLeft };
  } catch {
    return { active: false, secondsLeft: 0 };
  }
}

export function startTotpSetup(password: string) {
  return request<{ qrDataUrl: string; secret: string }>("/totp/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function confirmTotp(code: string) {
  return request<{ ok: true }>("/totp/confirm", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function adminSignIn(password: string, code: string) {
  return request<{ active: true; expiresInSeconds: number }>("/session", {
    method: "POST",
    body: JSON.stringify({ password, code }),
  });
}

export function adminSignOut() {
  return request<void>("/session/end", { method: "POST" });
}

/* ---- panel ---- */

export function getOverview() {
  return request<Overview>("/overview");
}

export function getMetrics(days: Range = 30) {
  return request<Metrics>(`/metrics?days=${days}`);
}

/** Drops blank values so an untouched filter never becomes `?q=&status=`. */
function qs(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== "ALL") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function getOrders(opts: { q?: string; status?: string; page?: number } = {}) {
  return request<Paged<OrderRow>>(`/orders${qs(opts)}`);
}

export function getOrder(id: string) {
  return request<{ order: OrderDetail }>(`/orders/${id}`);
}

/**
 * Refunds part or all of an order.
 *
 * Amount is explicit rather than defaulting to the whole order: the common
 * dispute is about one line in a basket spanning several sellers, and refunding
 * everything by accident takes money from sellers who did their part.
 */
export function refundOrder(
  orderId: string,
  amountCents: number,
  reason: string,
  orderItemId?: string | null
) {
  return request<{ refund: { id: string; status: string; amountCents: number } }>(
    `/orders/${orderId}/refund`,
    {
      method: "POST",
      body: JSON.stringify({ amountCents, reason, orderItemId: orderItemId ?? null }),
    }
  );
}

export function getCustomers(opts: { q?: string; filter?: string; page?: number } = {}) {
  return request<Paged<CustomerRow>>(`/customers${qs(opts)}`);
}

export function getCustomer(id: string) {
  return request<{ customer: CustomerDetail }>(`/customers/${id}`);
}

export function getCatalogue(opts: { q?: string; status?: string; page?: number } = {}) {
  return request<Paged<ListingRow>>(`/catalogue${qs(opts)}`);
}

/**
 * The delivery log.
 *
 * Search takes an email address or a name, because that is what a support
 * conversation actually starts with. An eventId works too, for whoever is
 * holding a dead-letter queue entry.
 */
export function getDeliveries(
  opts: { q?: string; channel?: string; status?: string; page?: number } = {}
) {
  return request<Paged<DeliveryRow> & { byStatus: Record<string, number> }>(
    `/deliveries${qs(opts)}`
  );
}

export type PayoutStatus = "PENDING" | "PAID" | "FAILED";

export type AdminPayoutRow = {
  id: string;
  amountCents: number;
  /** Kept back to settle a refund from an earlier payout, not sent. */
  nettedCents: number;
  currency: string;
  status: PayoutStatus;
  failureReason: string | null;
  providerTransferId: string | null;
  /** What to paste into the provider's dashboard. */
  connectAccountId: string | null;
  seller: { profileId: string; userId: string; email: string; name: string };
  itemCount: number;
  reversedCents: number;
  items: { orderItemId: string; amountCents: number; reversedAt: string | null }[];
  createdAt: string;
  completedAt: string | null;
};

export type PayoutTotals = {
  paidCents: number;
  nettedCents: number;
  outstandingDebtCents: number;
};

export function getPayoutLog(opts: { q?: string; status?: string; page?: number } = {}) {
  return request<
    Paged<AdminPayoutRow> & { byStatus: Record<string, number>; totals: PayoutTotals }
  >(`/payouts${qs(opts)}`);
}

export function getReports(status: "OPEN" | "RESOLVED" | "DISMISSED" | "ALL" = "OPEN") {
  return request<{ reports: Report[]; counts: Overview["reports"] }>(
    `/reports?status=${status}`
  );
}

export function resolveReport(id: string, outcome: string, dismissed: boolean) {
  return request<{ ok: true }>(`/reports/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify({ outcome, dismissed }),
  });
}

export function getAudit() {
  return request<{ actions: ModerationAction[] }>("/audit");
}

/* ---- actions. Every one requires a written reason. ---- */

export function removeListing(id: string, reason: string, reportId?: string | null) {
  return request<{ ok: true }>(`/listings/${id}/remove`, {
    method: "POST",
    body: JSON.stringify({ reason, reportId: reportId ?? null }),
  });
}

export function restoreListing(id: string, reason: string) {
  return request<{ ok: true }>(`/listings/${id}/restore`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function removeReview(id: string, reason: string, reportId?: string | null) {
  return request<{ ok: true }>(`/reviews/${id}/remove`, {
    method: "POST",
    body: JSON.stringify({ reason, reportId: reportId ?? null }),
  });
}

export function suspendUser(id: string, reason: string, reportId?: string | null) {
  return request<{ ok: true }>(`/users/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason, reportId: reportId ?? null }),
  });
}

export function reinstateUser(id: string, reason: string) {
  return request<{ ok: true }>(`/users/${id}/reinstate`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export const REASON_LABEL: Record<string, string> = {
  PROHIBITED_ITEM: "Shouldn't be sold here",
  COUNTERFEIT: "Counterfeit or fake",
  MISLEADING_DESCRIPTION: "Misleading description",
  SPAM: "Spam",
  HARASSMENT: "Abusive or harassing",
  OTHER: "Something else",
};

export const ACTION_LABEL: Record<string, string> = {
  LISTING_REMOVED: "Removed listing",
  LISTING_RESTORED: "Restored listing",
  USER_SUSPENDED: "Suspended account",
  USER_REINSTATED: "Reinstated account",
  REVIEW_REMOVED: "Removed review",
  REPORT_DISMISSED: "Dismissed report",
};

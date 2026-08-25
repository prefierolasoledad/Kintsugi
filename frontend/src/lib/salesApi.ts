import { ApiError } from "@/lib/api";

export type FulfilmentStatus = "UNFULFILLED" | "SHIPPED" | "DELIVERED" | "UNFULFILLABLE";

export type Sale = {
  id: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  currency: string;
  slug: string | null;
  image: string | null;
  order: {
    id: string;
    reference: string;
    buyerName: string;
    paidAt: string | null;
    placedAt: string;
  };
  fulfilment: FulfilmentStatus;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  fulfilmentNote: string | null;
  /** Released only once the order is paid. */
  shipTo: {
    fullName: string | null;
    line1: string;
    line2: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
    phone: string | null;
  } | null;
};

export type SalesSummary = {
  toSend: number;
  shipped: number;
  delivered: number;
  soldCount: number;
  /** Gross, before any fee. Not a payout balance — there is no payout pipeline. */
  grossCents: number;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/seller${path}`, {
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

export function getSales(filter: "all" | "to_send" | "sent" = "all") {
  return request<{ sales: Sale[]; summary: SalesSummary }>(`/sales?filter=${filter}`);
}

export function markShipped(
  saleId: string,
  input: { carrier?: string | null; trackingNumber?: string | null }
) {
  return request<{ sale: Sale }>(`/sales/${saleId}/ship`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function markCannotSend(saleId: string, reason: string) {
  return request<{ ok: true; refundOwed: boolean; note: string }>(
    `/sales/${saleId}/cannot-send`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  UNFULFILLED: "Needs sending",
  SHIPPED: "Sent",
  DELIVERED: "Delivered",
  UNFULFILLABLE: "Couldn't be sent",
};

/** The buyer's side of the same field, phrased from their point of view. */
export const BUYER_FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  UNFULFILLED: "Awaiting dispatch",
  SHIPPED: "On its way",
  DELIVERED: "Delivered",
  UNFULFILLABLE: "Seller couldn't send it",
};

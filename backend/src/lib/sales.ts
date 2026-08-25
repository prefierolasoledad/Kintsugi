import { prisma } from "./prisma";
import { FulfilmentStatus, OrderStatus } from "../generated/prisma/enums";

/**
 * What a seller has sold, and sending it.
 *
 * WHY THIS DID NOT EXIST
 * Order lines carried a `sellerName` string and nothing else, so there was no
 * way to ask "what did I sell?". Someone could buy a chair and the seller would
 * never be told, never see it, and never be able to act on it. The marketplace
 * loop was open at exactly the point where a real transaction begins.
 *
 * ONLY PAID ORDERS COUNT
 * A seller sees a line once the money has actually moved. Showing them a
 * PENDING_PAYMENT order would have them packing parcels for checkouts that get
 * abandoned — and roughly half of all abandoned carts sit in that state until a
 * sweeper releases them.
 */

export class SalesError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "SalesError";
    this.code = code;
    this.status = status;
  }
}

const saleSelect = {
  id: true,
  title: true,
  unitPriceCents: true,
  quantity: true,
  fulfilment: true,
  shippedAt: true,
  deliveredAt: true,
  carrier: true,
  trackingNumber: true,
  fulfilmentNote: true,
  listing: {
    select: {
      slug: true,
      images: { take: 1, orderBy: { position: "asc" as const }, select: { url: true } },
    },
  },
  order: {
    select: {
      id: true,
      reference: true,
      currency: true,
      paidAt: true,
      createdAt: true,
      buyer: { select: { name: true } },
      shipToName: true,
      shipToLine1: true,
      shipToLine2: true,
      shipToCity: true,
      shipToRegion: true,
      shipToPostcode: true,
      shipToCountry: true,
      shipToPhone: true,
    },
  },
} as const;

type SaleRow = Awaited<ReturnType<typeof fetchSales>>[number];

function fetchSales(sellerId: string, where: object, take: number) {
  return prisma.orderItem.findMany({
    where: { sellerId, order: { status: OrderStatus.PAID }, ...where },
    // Oldest paid first: the thing waiting longest is the thing to post next.
    orderBy: { order: { paidAt: "asc" } },
    take,
    select: saleSelect,
  });
}

function serialize(row: SaleRow) {
  const o = row.order;
  return {
    id: row.id,
    title: row.title,
    unitPriceCents: row.unitPriceCents,
    quantity: row.quantity,
    currency: o.currency,
    slug: row.listing?.slug ?? null,
    image: row.listing?.images[0]?.url ?? null,

    order: {
      id: o.id,
      reference: o.reference,
      buyerName: o.buyer.name,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      placedAt: o.createdAt.toISOString(),
    },

    fulfilment: row.fulfilment,
    shippedAt: row.shippedAt ? row.shippedAt.toISOString() : null,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    fulfilmentNote: row.fulfilmentNote,

    /**
     * The buyer's address, released only once the order is PAID — which the
     * query above enforces. A seller has no business seeing where someone
     * lives before they have bought anything.
     */
    shipTo: o.shipToLine1
      ? {
          fullName: o.shipToName,
          line1: o.shipToLine1,
          line2: o.shipToLine2,
          city: o.shipToCity,
          region: o.shipToRegion,
          postcode: o.shipToPostcode,
          country: o.shipToCountry,
          phone: o.shipToPhone,
        }
      : null,
  };
}

export type SaleView = ReturnType<typeof serialize>;

export async function listSales(
  sellerId: string,
  filter: "all" | "to_send" | "sent" = "all",
  take = 100
) {
  const where =
    filter === "to_send"
      ? { fulfilment: FulfilmentStatus.UNFULFILLED }
      : filter === "sent"
        ? { fulfilment: { in: [FulfilmentStatus.SHIPPED, FulfilmentStatus.DELIVERED] } }
        : {};

  const rows = await fetchSales(sellerId, where, take);
  return rows.map(serialize);
}

/** Counts for the dashboard tabs, so a seller sees what needs doing. */
export async function salesSummary(sellerId: string) {
  const base = { sellerId, order: { status: OrderStatus.PAID } };

  const [toSend, shipped, delivered, revenue] = await Promise.all([
    prisma.orderItem.count({ where: { ...base, fulfilment: FulfilmentStatus.UNFULFILLED } }),
    prisma.orderItem.count({ where: { ...base, fulfilment: FulfilmentStatus.SHIPPED } }),
    prisma.orderItem.count({ where: { ...base, fulfilment: FulfilmentStatus.DELIVERED } }),
    prisma.orderItem.findMany({ where: base, select: { unitPriceCents: true, quantity: true } }),
  ]);

  return {
    toSend,
    shipped,
    delivered,
    soldCount: revenue.length,
    /**
     * Gross, before any fee. Named so nobody mistakes it for a payout balance
     * — there is no payout pipeline, and calling this "earnings" would imply
     * money is waiting somewhere for them.
     */
    grossCents: revenue.reduce((sum, r) => sum + r.unitPriceCents * r.quantity, 0),
  };
}

/** One sale, scoped to its seller. */
export async function getSale(sellerId: string, orderItemId: string) {
  const row = await prisma.orderItem.findFirst({
    where: { id: orderItemId, sellerId, order: { status: OrderStatus.PAID } },
    select: saleSelect,
  });
  return row ? serialize(row) : null;
}

/**
 * Marks a line as sent.
 *
 * Scoped by sellerId in the same query that finds it, so one seller can never
 * fulfil another's line — and a 404 rather than a 403, so probing tells them
 * nothing.
 */
export async function markShipped(input: {
  sellerId: string;
  orderItemId: string;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const line = await prisma.orderItem.findFirst({
    where: { id: input.orderItemId, sellerId: input.sellerId, order: { status: OrderStatus.PAID } },
    select: { id: true, fulfilment: true },
  });
  if (!line) throw new SalesError("NOT_FOUND", "Sale not found.", 404);

  if (line.fulfilment === FulfilmentStatus.SHIPPED) {
    // Idempotent: a double-tapped button should update the tracking number, not
    // complain.
    return prisma.orderItem.update({
      where: { id: line.id },
      data: {
        carrier: input.carrier?.trim() || null,
        trackingNumber: input.trackingNumber?.trim() || null,
      },
      select: saleSelect,
    }).then(serialize);
  }

  if (line.fulfilment !== FulfilmentStatus.UNFULFILLED) {
    throw new SalesError(
      "NOT_SHIPPABLE",
      line.fulfilment === FulfilmentStatus.DELIVERED
        ? "That's already been delivered."
        : "That sale can no longer be shipped.",
      409
    );
  }

  const updated = await prisma.orderItem.update({
    where: { id: line.id },
    data: {
      fulfilment: FulfilmentStatus.SHIPPED,
      shippedAt: new Date(),
      carrier: input.carrier?.trim() || null,
      trackingNumber: input.trackingNumber?.trim() || null,
      fulfilmentNote: null,
    },
    select: saleSelect,
  });
  return serialize(updated);
}

/**
 * The buyer confirms arrival.
 *
 * Deliberately the BUYER's action, not the seller's. A seller marking their own
 * parcel delivered is not evidence of anything, and once payouts exist that
 * confirmation is what money would hang on.
 */
export async function markDelivered(buyerId: string, orderItemId: string) {
  const line = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      order: { buyerId, status: OrderStatus.PAID },
    },
    select: { id: true, fulfilment: true },
  });
  if (!line) throw new SalesError("NOT_FOUND", "Item not found.", 404);

  if (line.fulfilment === FulfilmentStatus.DELIVERED) return; // idempotent
  if (line.fulfilment !== FulfilmentStatus.SHIPPED) {
    throw new SalesError("NOT_SHIPPED", "That hasn't been sent yet.", 409);
  }

  await prisma.orderItem.update({
    where: { id: line.id },
    data: { fulfilment: FulfilmentStatus.DELIVERED, deliveredAt: new Date() },
  });
}

/** The seller cannot send it after all. */
export async function markUnfulfillable(input: {
  sellerId: string;
  orderItemId: string;
  reason: string;
}) {
  const line = await prisma.orderItem.findFirst({
    where: { id: input.orderItemId, sellerId: input.sellerId, order: { status: OrderStatus.PAID } },
    select: { id: true, fulfilment: true },
  });
  if (!line) throw new SalesError("NOT_FOUND", "Sale not found.", 404);

  if (line.fulfilment === FulfilmentStatus.DELIVERED) {
    throw new SalesError("ALREADY_DELIVERED", "That's already been delivered.", 409);
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new SalesError("REASON_REQUIRED", "Tell the buyer why.", 400);
  }

  await prisma.orderItem.update({
    where: { id: line.id },
    data: {
      fulfilment: FulfilmentStatus.UNFULFILLABLE,
      fulfilmentNote: reason,
      shippedAt: null,
    },
  });

  /**
   * NOT REFUNDED HERE. The buyer has paid for something they will not receive,
   * which is a refund — and refunds are Phase 2. Marking this without saying so
   * would leave money quietly kept for nothing, so the route returns a flag the
   * UI states plainly rather than implying the matter is settled.
   */
  return { refundOwed: true };
}

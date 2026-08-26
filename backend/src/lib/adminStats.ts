import { prisma } from "./prisma";
import {
  OrderStatus,
  ListingStatus,
  RefundStatus,
  ReportStatus,
} from "../generated/prisma/enums";

/**
 * Read-only queries behind the admin dashboard.
 *
 * Everything here is a SELECT. Nothing in this file changes state — the actions
 * live in moderation.ts, where each one writes an audit row. Keeping the two
 * apart means a dashboard query can never quietly become a dashboard action.
 *
 * ON THE WORD "REVENUE"
 * ---------------------
 * It does not appear here, and that is deliberate. Kintsugi takes no cut, so
 * every cent counted below belongs to a seller, not to the platform. Labelling
 * it revenue would make the headline number on the dashboard a lie — the kind
 * that survives right up until someone forecasts against it. It is called gross
 * sales throughout: money that moved through the site.
 */

export type Range = 7 | 30 | 90;

/** A page of rows, in the one shape every list endpoint returns. */
export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
};

const PAGE_SIZE = 25;

function paginate(page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { skip: (current - 1) * PAGE_SIZE, page: current, pages, pageSize: PAGE_SIZE };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ================================================================== *
 * Headline metrics
 * ================================================================== */

type Totals = { grossCents: number; orders: number; buyers: number };

async function totalsBetween(from: Date, to: Date): Promise<Totals> {
  const rows = await prisma.$queryRaw<
    Array<{ cents: bigint; orders: bigint; buyers: bigint }>
  >`
    SELECT
      COALESCE(SUM("subtotalCents"), 0)::bigint AS cents,
      COUNT(*)::bigint                          AS orders,
      COUNT(DISTINCT "buyerId")::bigint         AS buyers
    FROM orders
    WHERE status = 'PAID' AND "paidAt" >= ${from} AND "paidAt" < ${to}
  `;
  const r = rows[0];
  return {
    grossCents: Number(r?.cents ?? 0),
    orders: Number(r?.orders ?? 0),
    buyers: Number(r?.buyers ?? 0),
  };
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Null rather than 0 or 100: a period with no prior sales has no meaningful
 * change, and rendering "+100%" against zero is how dashboards manufacture
 * good news. The frontend shows a dash.
 */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * The daily series for the chart.
 *
 * Days with no orders are filled in as zero. Without that, Postgres returns
 * only the days that had sales and the chart draws a smooth line across a
 * fortnight of silence — the gap is exactly the thing worth seeing.
 */
async function dailySeries(days: number) {
  const from = daysAgo(days - 1);
  const rows = await prisma.$queryRaw<Array<{ day: Date; cents: bigint; orders: bigint }>>`
    SELECT
      date_trunc('day', "paidAt")               AS day,
      COALESCE(SUM("subtotalCents"), 0)::bigint AS cents,
      COUNT(*)::bigint                          AS orders
    FROM orders
    WHERE status = 'PAID' AND "paidAt" >= ${from}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map(
    rows.map((r) => [
      new Date(r.day).toISOString().slice(0, 10),
      { cents: Number(r.cents), orders: Number(r.orders) },
    ])
  );

  const series: Array<{ date: string; grossCents: number; orders: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const hit = byDay.get(key);
    series.push({ date: key, grossCents: hit?.cents ?? 0, orders: hit?.orders ?? 0 });
  }
  return series;
}

/**
 * Money sent back in a window.
 *
 * PENDING counts alongside SUCCEEDED. A refund in flight is money leaving, and
 * excluding it would show a figure that is about to be wrong. FAILED does not
 * count — that money never left.
 */
async function refundedBetween(from: Date, to: Date): Promise<number> {
  const agg = await prisma.refund.aggregate({
    where: {
      status: { in: [RefundStatus.PENDING, RefundStatus.SUCCEEDED] },
      createdAt: { gte: from, lt: to },
    },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

export async function metrics(days: Range) {
  const now = new Date();
  const periodStart = daysAgo(days - 1);
  const priorStart = daysAgo(days * 2 - 1);

  const [current, prior, series, newUsers, priorNewUsers, refunded, priorRefunded] =
    await Promise.all([
      totalsBetween(periodStart, now),
      totalsBetween(priorStart, periodStart),
      dailySeries(days),
      prisma.user.count({ where: { createdAt: { gte: periodStart } } }),
      prisma.user.count({ where: { createdAt: { gte: priorStart, lt: periodStart } } }),
      refundedBetween(periodStart, now),
      refundedBetween(priorStart, periodStart),
    ]);

  // Average order value, in cents. Guarded because a period with no orders
  // would otherwise divide by zero and render NaN on the dashboard.
  const aov = current.orders > 0 ? Math.round(current.grossCents / current.orders) : 0;
  const priorAov = prior.orders > 0 ? Math.round(prior.grossCents / prior.orders) : 0;

  return {
    days,
    grossCents: current.grossCents,
    orders: current.orders,
    buyers: current.buyers,
    aovCents: aov,
    newUsers,
    /**
     * Shown alongside gross rather than subtracted from it.
     *
     * A fully refunded order leaves the PAID set and drops out of gross on its
     * own. A PARTLY refunded one stays PAID, so its whole subtotal is still
     * counted — which would quietly overstate the figure. Reporting both lets
     * the reader do the subtraction knowingly instead of being handed a net
     * number that hides how much came back.
     */
    refundedCents: refunded,
    deltas: {
      gross: delta(current.grossCents, prior.grossCents),
      orders: delta(current.orders, prior.orders),
      aov: delta(aov, priorAov),
      newUsers: delta(newUsers, priorNewUsers),
      refunded: delta(refunded, priorRefunded),
    },
    series,
  };
}

/* ================================================================== *
 * What needs a human
 * ================================================================== */

/**
 * The queue behind the dashboard's "Needs attention" panel.
 *
 * Each entry is something a person has to decide about. Counts that are merely
 * interesting — total users, total listings — are not here; they belong in the
 * stat row where nobody feels obliged to act on them.
 */
export async function attention() {
  const staleAfter = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const [openReports, unfulfilled, stuck, failedPayments, rejectedKyc] = await Promise.all([
    prisma.report.count({ where: { status: ReportStatus.OPEN } }),
    prisma.orderItem.count({
      where: { fulfilment: "UNFULFILLED", order: { status: OrderStatus.PAID, paidAt: { lt: staleAfter } } },
    }),
    // An order left mid-payment. The sweeper reconciles these, so a non-zero
    // count that persists means the sweeper is not running.
    prisma.order.count({
      where: { status: OrderStatus.PROCESSING, updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
    }),
    prisma.order.count({
      where: { status: OrderStatus.FAILED, createdAt: { gte: daysAgo(7) } },
    }),
    prisma.sellerProfile.count({ where: { kycStatus: "REJECTED" } }),
  ]);

  return { openReports, unfulfilledOver3Days: unfulfilled, stuckPayments: stuck, failedPayments, rejectedKyc };
}

/* ================================================================== *
 * Orders
 * ================================================================== */

export async function listOrders(opts: {
  q?: string;
  status?: OrderStatus | "ALL";
  page?: number;
}): Promise<Page<Awaited<ReturnType<typeof shapeOrder>>>> {
  const where = {
    ...(opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
    ...(opts.q
      ? {
          OR: [
            { reference: { contains: opts.q, mode: "insensitive" as const } },
            { buyer: { email: { contains: opts.q, mode: "insensitive" as const } } },
            { buyer: { name: { contains: opts.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const total = await prisma.order.count({ where });
  const { skip, page, pages, pageSize } = paginate(opts.page ?? 1, total);

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    include: {
      buyer: { select: { id: true, name: true, email: true } },
      items: { select: { id: true, quantity: true, fulfilment: true } },
    },
  });

  return { rows: orders.map(shapeOrder), total, page, pages, pageSize };
}

function shapeOrder(o: {
  id: string;
  reference: string;
  status: OrderStatus;
  subtotalCents: number;
  currency: string;
  createdAt: Date;
  paidAt: Date | null;
  buyer: { id: string; name: string; email: string };
  items: Array<{ id: string; quantity: number; fulfilment: string }>;
}) {
  const units = o.items.reduce((n, i) => n + i.quantity, 0);
  const shipped = o.items.filter((i) => i.fulfilment !== "UNFULFILLED").length;
  return {
    id: o.id,
    reference: o.reference,
    status: o.status,
    subtotalCents: o.subtotalCents,
    currency: o.currency,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    buyerId: o.buyer.id,
    buyerName: o.buyer.name,
    buyerEmail: o.buyer.email,
    lines: o.items.length,
    units,
    fulfilledLines: shipped,
  };
}

export async function orderDetail(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      buyer: { select: { id: true, name: true, email: true, createdAt: true, suspendedAt: true } },
      items: {
        include: {
          listing: { select: { id: true, slug: true, title: true, status: true, deletedAt: true } },
          seller: { select: { id: true, shopName: true, userId: true } },
        },
      },
    },
  });
  if (!order) return null;

  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    subtotalCents: order.subtotalCents,
    currency: order.currency,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    failureReason: order.failureReason,
    // The provider's id, not card data — there is none of that here to show.
    // See docs/adr/0013-payment-provider-seam.md
    paymentProvider: order.paymentProvider,
    paymentIntentId: order.paymentIntentId,
    buyer: order.buyer,
    shipTo: order.shipToLine1
      ? {
          name: order.shipToName,
          line1: order.shipToLine1,
          line2: order.shipToLine2,
          city: order.shipToCity,
          region: order.shipToRegion,
          postcode: order.shipToPostcode,
          country: order.shipToCountry,
          phone: order.shipToPhone,
        }
      : null,
    items: order.items.map((i) => ({
      id: i.id,
      title: i.title,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      sellerName: i.sellerName,
      sellerUserId: i.seller?.userId ?? null,
      fulfilment: i.fulfilment,
      carrier: i.carrier,
      trackingNumber: i.trackingNumber,
      fulfilmentNote: i.fulfilmentNote,
      shippedAt: i.shippedAt,
      deliveredAt: i.deliveredAt,
      listingId: i.listing?.id ?? null,
      listingSlug: i.listing?.slug ?? null,
      // True when the line's product no longer exists. The order still shows
      // what was bought because the title and price were snapshotted onto it.
      listingGone: !i.listing || i.listing.deletedAt !== null,
    })),
  };
}

/* ================================================================== *
 * Customers
 * ================================================================== */

export async function listCustomers(opts: {
  q?: string;
  filter?: "ALL" | "SELLERS" | "SUSPENDED" | "ADMINS";
  page?: number;
}) {
  const where = {
    ...(opts.filter === "SELLERS" ? { isSeller: true } : {}),
    ...(opts.filter === "SUSPENDED" ? { suspendedAt: { not: null } } : {}),
    ...(opts.filter === "ADMINS" ? { role: "ADMIN" as const } : {}),
    ...(opts.q
      ? {
          OR: [
            { email: { contains: opts.q, mode: "insensitive" as const } },
            { name: { contains: opts.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const total = await prisma.user.count({ where });
  const { skip, page, pages, pageSize } = paginate(opts.page ?? 1, total);

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      isSeller: true,
      emailVerified: true,
      role: true,
      suspendedAt: true,
      suspendedReason: true,
      _count: { select: { orders: true } },
    },
  });

  return {
    rows: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      isSeller: u.isSeller,
      emailVerified: u.emailVerified,
      role: u.role,
      suspendedAt: u.suspendedAt,
      suspendedReason: u.suspendedReason,
      orders: u._count.orders,
    })),
    total,
    page,
    pages,
    pageSize,
  };
}

export async function customerDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      isSeller: true,
      emailVerified: true,
      role: true,
      avatarUrl: true,
      suspendedAt: true,
      suspendedReason: true,
      sellerProfile: {
        select: {
          id: true,
          shopName: true,
          kycStatus: true,
          payoutsEnabled: true,
          _count: { select: { listings: true, sales: true } },
        },
      },
    },
  });
  if (!user) return null;

  const [orders, spend, reportsAgainst] = await Promise.all([
    prisma.order.findMany({
      where: { buyerId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, reference: true, status: true, subtotalCents: true, createdAt: true },
    }),
    prisma.order.aggregate({
      where: { buyerId: id, status: OrderStatus.PAID },
      _sum: { subtotalCents: true },
      _count: true,
    }),
    prisma.report.count({ where: { targetType: "USER", targetId: id } }),
  ]);

  return {
    ...user,
    lifetimeSpendCents: spend._sum.subtotalCents ?? 0,
    paidOrders: spend._count,
    recentOrders: orders,
    reportsAgainst,
  };
}

/* ================================================================== *
 * Catalogue
 * ================================================================== */

export async function listCatalogue(opts: {
  q?: string;
  status?: ListingStatus | "ALL" | "REMOVED";
  page?: number;
}) {
  const where = {
    ...(opts.status === "REMOVED"
      ? { deletedAt: { not: null } }
      : opts.status && opts.status !== "ALL"
        ? { status: opts.status, deletedAt: null }
        : {}),
    ...(opts.q
      ? {
          OR: [
            { title: { contains: opts.q, mode: "insensitive" as const } },
            { seller: { shopName: { contains: opts.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const total = await prisma.listing.count({ where });
  const { skip, page, pages, pageSize } = paginate(opts.page ?? 1, total);

  const listings = await prisma.listing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: pageSize,
    select: {
      id: true,
      slug: true,
      title: true,
      priceCents: true,
      currency: true,
      quantity: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      condition: true,
      seller: { select: { id: true, shopName: true, userId: true } },
      category: { select: { title: true } },
      images: { select: { url: true }, take: 1, orderBy: { position: "asc" } },
      _count: { select: { reviews: true, orderItems: true } },
    },
  });

  return {
    rows: listings.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      priceCents: l.priceCents,
      currency: l.currency,
      quantity: l.quantity,
      status: l.status,
      removed: l.deletedAt !== null,
      createdAt: l.createdAt,
      condition: l.condition,
      sellerName: l.seller.shopName,
      sellerUserId: l.seller.userId,
      category: l.category.title,
      image: l.images[0]?.url ?? null,
      reviews: l._count.reviews,
      sold: l._count.orderItems,
    })),
    total,
    page,
    pages,
    pageSize,
  };
}

/* ================================================================== *
 * Recent activity, for the dashboard
 * ================================================================== */

export async function recentOrders(limit = 8) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      buyer: { select: { id: true, name: true, email: true } },
      items: { select: { id: true, quantity: true, fulfilment: true } },
    },
  });
  return orders.map(shapeOrder);
}

/**
 * Sellers ranked by what they actually sold, not by what they listed.
 *
 * Only PAID orders count. Counting held or failed ones would put a seller with
 * an abandoned basket above one with a real sale.
 */
export async function topSellers(days: Range, limit = 5) {
  const from = daysAgo(days - 1);
  const rows = await prisma.$queryRaw<
    Array<{ sellerId: string; shopName: string; userId: string; cents: bigint; units: bigint }>
  >`
    SELECT
      sp.id                                                   AS "sellerId",
      sp."shopName"                                           AS "shopName",
      sp."userId"                                             AS "userId",
      COALESCE(SUM(oi."unitPriceCents" * oi.quantity), 0)::bigint AS cents,
      COALESCE(SUM(oi.quantity), 0)::bigint                   AS units
    FROM order_items oi
    JOIN orders o        ON o.id = oi."orderId"
    JOIN seller_profiles sp ON sp.id = oi."sellerId"
    WHERE o.status = 'PAID' AND o."paidAt" >= ${from}
    GROUP BY sp.id, sp."shopName", sp."userId"
    ORDER BY cents DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    sellerId: r.sellerId,
    shopName: r.shopName,
    userId: r.userId,
    grossCents: Number(r.cents),
    units: Number(r.units),
  }));
}

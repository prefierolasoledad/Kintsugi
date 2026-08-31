import { cached, invalidate } from "./cache";
import { UNREAD_TTL, unreadKey } from "./cacheKeys";
import { prisma } from "./prisma";
import { NotificationType } from "../generated/prisma/enums";

/**
 * Telling people what happened to them.
 *
 * IN-APP ONLY, AND HONEST ABOUT IT
 * Email delivery exists now (lib/mailer.ts), and nothing here uses it. Mailing
 * every sale, shipment, and moderation decision needs per-type preferences and
 * an unsubscribe path first — without those it is the reason someone filters
 * this domain to spam, and then they stop seeing the ones that matter. This
 * table remains the source of truth, so adding mail later means reading from
 * here rather than replacing it. Nothing below assumes a delivery channel.
 *
 * TEXT IS WRITTEN AT CREATION, NOT RENDERED LATER
 * Same reasoning as OrderItem's snapshots. "Cast iron skillet sold" has to keep
 * saying that after the listing is renamed, repriced, or deleted — and a
 * notification that re-derives its own text from live rows would break entirely
 * once the row is gone. The `link` may rot into a 404; the sentence never does.
 *
 * NEVER THROWS INTO THE CALLER
 * A notification is a side effect of something more important. Failing to tell
 * someone their item sold must not roll back the sale, so every emit is
 * best-effort and logs rather than propagating.
 */

type EmitInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
};

/**
 * Records one notification. Deliberately swallows its own errors.
 *
 * Callers are payment, fulfilment, and moderation paths — places where an
 * exception would undo work that actually matters.
 */
export async function notify(input: EmitInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
    await invalidate(unreadKey(input.userId));
  } catch (err) {
    console.error(`Failed to notify ${input.userId} (${input.type})`, err);
  }
}

/** Several at once, for an order that spans sellers. */
export async function notifyMany(inputs: EmitInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        type: i.type,
        title: i.title,
        body: i.body ?? null,
        link: i.link ?? null,
      })),
    });
    // One basket can notify several sellers, so every recipient's badge is
    // stale, not just one.
    await invalidate(...new Set(inputs.map((i) => unreadKey(i.userId))));
  } catch (err) {
    console.error(`Failed to notify ${inputs.length} recipient(s)`, err);
  }
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
} as const;

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean; take?: number } = {}
) {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
    select: notificationSelect,
  });

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  }));
}

/** The exact count, straight from the database. */
export function countUnread(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * The same number, cached — for the polling badge ONLY.
 *
 * CACHED BECAUSE OF HOW IT IS CALLED, not because the query is expensive.
 * Every signed-in tab polls /notifications/count on a timer for as long as it
 * stays open, so the load scales with tabs left open rather than with anything
 * anyone does. It is the only endpoint in the codebase with that shape.
 *
 * NOT USED BY GET /notifications, deliberately.
 * That route returns the unread LIST and the count in one payload. Serving a
 * cached count beside a live list means the page can show three unread items
 * under a badge reading zero — a contradiction inside a single response, which
 * reads as a bug in a way that a slightly-late badge never does. It has already
 * paid for a query there; one more costs nothing.
 *
 * Every write below drops this key, so a poller sees a number that is either
 * current or at most one TTL behind — and it was already going to be that far
 * behind between polls.
 */
export function cachedUnreadCount(userId: string) {
  return cached(unreadKey(userId), UNREAD_TTL, () => countUnread(userId));
}

/** Scoped by user, so nobody can mark someone else's as read. */
export async function markRead(userId: string, notificationId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  // Invalidated even when count is 0. The write may have changed nothing, but
  // a cached count from before some *other* write is still worth dropping, and
  // guessing wrong here shows up as a badge that will not clear.
  await invalidate(unreadKey(userId));
  // Already-read is a success, not a 404: opening the same thing twice is
  // normal, and an error there would be noise.
  return count;
}

export async function markAllRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  await invalidate(unreadKey(userId));
  return count;
}

export async function removeNotification(userId: string, notificationId: string) {
  const { count } = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
  // Deleting an UNREAD notification lowers the count, so this is a write that
  // changes the badge even though it never touches readAt.
  await invalidate(unreadKey(userId));
  return count;
}

/* ------------------------------------------------------------------ *
 * The events worth telling someone about
 *
 * Each one is a thing that HAPPENED to the recipient. Nothing here is
 * promotional: a list that mixes "your order shipped" with "check out our new
 * arrivals" teaches people to ignore both.
 * ------------------------------------------------------------------ */

export const events = {
  /** Seller: someone bought your item. */
  saleMade(input: {
    sellerUserId: string;
    itemTitle: string;
    buyerName: string;
    orderReference: string;
  }) {
    return notify({
      userId: input.sellerUserId,
      type: NotificationType.SALE_MADE,
      title: `${input.itemTitle} sold`,
      body: `${input.buyerName} bought it. Order ${input.orderReference} — send it when you can.`,
      link: "/seller/sales",
    });
  },

  /** Buyer: the seller has sent it. */
  orderShipped(input: {
    buyerUserId: string;
    itemTitle: string;
    orderId: string;
    carrier?: string | null;
    trackingNumber?: string | null;
  }) {
    const tracking = input.trackingNumber
      ? `${input.carrier ? `${input.carrier}: ` : ""}${input.trackingNumber}`
      : null;
    return notify({
      userId: input.buyerUserId,
      type: NotificationType.ORDER_SHIPPED,
      title: `${input.itemTitle} is on its way`,
      body: tracking ?? "The seller has posted it.",
      link: `/orders/${input.orderId}`,
    });
  },

  /** Seller: the buyer confirmed it arrived. */
  orderDelivered(input: { sellerUserId: string; itemTitle: string }) {
    return notify({
      userId: input.sellerUserId,
      type: NotificationType.ORDER_DELIVERED,
      title: `${input.itemTitle} arrived`,
      body: "The buyer confirmed delivery.",
      link: "/seller/sales",
    });
  },

  /** Buyer: the seller cannot send it after all. */
  orderUnfulfillable(input: {
    buyerUserId: string;
    itemTitle: string;
    orderId: string;
    reason: string;
    /** Whether the money actually went back. */
    refunded: boolean;
  }) {
    return notify({
      userId: input.buyerUserId,
      type: NotificationType.ORDER_UNFULFILLABLE,
      title: `${input.itemTitle} can't be sent`,
      /**
       * The wording follows what happened, not what was intended.
       *
       * This used to say refunds were not automated — true then, false now. The
       * flag matters because a refund can still fail: telling somebody their
       * money is back when it is not is worse than telling them nothing, since
       * they would then find out from their bank rather than from us.
       */
      body: input.refunded
        ? `${input.reason} You've been refunded for it.`
        : `${input.reason} We couldn't complete your refund automatically — it's been logged and someone will settle it.`,
      link: `/orders/${input.orderId}`,
    });
  },

  /**
   * Buyer: money has gone back.
   *
   * Separate from orderUnfulfillable even though the two usually arrive
   * together. A refund can also come from a moderator settling a dispute, and
   * folding it into the "can't send it" message would make that case read as
   * something it is not.
   */
  refundIssued(input: {
    buyerUserId: string;
    orderId: string;
    amountCents: number;
    currency: string;
    reason: string;
  }) {
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: input.currency,
      maximumFractionDigits: input.amountCents % 100 === 0 ? 0 : 2,
    }).format(input.amountCents / 100);

    return notify({
      userId: input.buyerUserId,
      type: NotificationType.REFUND_ISSUED,
      title: `${amount} refunded`,
      // Banks take their own time. Saying "refunded" with no timescale
      // generates a support message on day two.
      body: `${input.reason} It can take a few days to appear on your statement.`,
      link: `/orders/${input.orderId}`,
    });
  },

  /** Seller: someone reviewed something you sold. */
  reviewReceived(input: {
    sellerUserId: string;
    itemTitle: string;
    rating: number;
    listingSlug: string;
  }) {
    return notify({
      userId: input.sellerUserId,
      type: NotificationType.REVIEW_RECEIVED,
      title: `${input.rating}-star review on ${input.itemTitle}`,
      body: null,
      link: `/listing/${input.listingSlug}#reviews`,
    });
  },

  identityVerified(userId: string) {
    return notify({
      userId,
      type: NotificationType.IDENTITY_VERIFIED,
      title: "Your identity is verified",
      body: "Payouts are unlocked and your listings show a verified badge.",
      link: "/seller/verify",
    });
  },

  identityRejected(input: { userId: string; reason: string }) {
    return notify({
      userId: input.userId,
      type: NotificationType.IDENTITY_REJECTED,
      title: "That identity check didn't pass",
      body: `${input.reason} Your listings stay up — only payouts are locked.`,
      link: "/seller/verify",
    });
  },

  listingRemoved(input: { sellerUserId: string; itemTitle: string; reason: string }) {
    return notify({
      userId: input.sellerUserId,
      type: NotificationType.LISTING_REMOVED,
      title: `${input.itemTitle} was removed`,
      body: input.reason,
      link: "/seller",
    });
  },

  accountSuspended(input: { userId: string; reason: string }) {
    return notify({
      userId: input.userId,
      type: NotificationType.ACCOUNT_SUSPENDED,
      title: "Your account has been suspended",
      body: input.reason,
      link: null,
    });
  },

  reportResolved(input: { reporterUserId: string; outcome: string }) {
    return notify({
      userId: input.reporterUserId,
      type: NotificationType.REPORT_RESOLVED,
      title: "We looked at what you reported",
      body: input.outcome,
      link: null,
    });
  },
};

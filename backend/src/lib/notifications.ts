import { prisma } from "./prisma";
import { NotificationType } from "../generated/prisma/enums";

/**
 * Telling people what happened to them.
 *
 * IN-APP ONLY, AND HONEST ABOUT IT
 * There is no email delivery — the mailer writes to the console. So this table
 * is the whole notification system rather than a queue feeding one. When email
 * lands it will read from here rather than replace it, which is why nothing
 * below assumes a delivery channel.
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

export function countUnread(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Scoped by user, so nobody can mark someone else's as read. */
export async function markRead(userId: string, notificationId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  // Already-read is a success, not a 404: opening the same thing twice is
  // normal, and an error there would be noise.
  return count;
}

export async function markAllRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}

export async function removeNotification(userId: string, notificationId: string) {
  const { count } = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
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
  }) {
    return notify({
      userId: input.buyerUserId,
      type: NotificationType.ORDER_UNFULFILLABLE,
      title: `${input.itemTitle} can't be sent`,
      // States the refund position plainly, because refunds are not built and
      // implying otherwise would be worse than saying nothing.
      body: `${input.reason} You paid for this — refunds aren't automated yet, so it needs settling with the seller.`,
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

import { prisma } from "./prisma";
import { shouldSend } from "./channelPolicy";
import type { NotificationEvent } from "./outbox";
import { DeliveryChannel, DeliveryStatus } from "../generated/prisma/enums";

/**
 * The delivery ledger: what was sent, on which channel, and what came back.
 *
 * WHY THIS EXISTS AT ALL
 * Everything upstream delivers at least once on purpose. The relay publishes
 * and then marks publishedAt, so a crash between them republishes. A Kafka
 * consumer that sends and then dies before committing its offset reprocesses on
 * restart. A rebalance during a rolling deploy hands a partition back at the
 * last committed offset. None of those are failures — they are Tuesday.
 *
 * Without a record of what has already been sent, each one is a second email,
 * and later a second SMS.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE DESIGN
 *   1. resolve preferences; if off, write SUPPRESSED and stop
 *   2. INSERT PENDING — a unique violation means somebody else has it, return
 *   3. call the provider
 *   4. update to SENT with its message id, or FAILED with the reason
 *
 * Step 2 is the guard. It is the same discipline as claiming an order before
 * charging it (ADR 0013) and claiming refund headroom before refunding
 * (ADR 0016): mutual exclusion is decided by whether a write matched, and only
 * the winner may talk to the provider. There is no window between checking and
 * claiming, because the check IS the claim.
 *
 * Checking first and inserting after would reintroduce the read-then-write race
 * that ADR 0012 exists to prevent — two consumers both read "no row", both
 * decide to send, and both send.
 *
 * See docs/adr/0026-delivery-idempotency.md
 */

/** Postgres unique-violation. A collision here is the mechanism working. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "P2002" || code === "23505";
}

export type Claim =
  /** This process owns the delivery. Call the provider, then settle it. */
  | { claimed: true; id: string }
  /** Somebody else already has it, or it is not being sent at all. */
  | { claimed: false; reason: "duplicate" | "suppressed" | "error" };

/**
 * Resolves preferences and claims the delivery in one step.
 *
 * Returns `claimed: false` far more often than it returns true, and almost none
 * of those are errors: a suppressed channel and a redelivered message are both
 * ordinary. Callers must not log them as failures — doing so fills the log
 * during every rolling deploy and teaches people to ignore it.
 */
export async function claim(
  event: NotificationEvent,
  channel: DeliveryChannel
): Promise<Claim> {
  const decision = await shouldSend({
    userId: event.userId,
    type: event.type,
    channel,
  });

  if (!decision.send) {
    /**
     * Recorded, not dropped. "Why did I not get a text about my refund?" has to
     * have an answer, and reconstructing one from preferences that have since
     * been edited is not an answer.
     *
     * The same unique constraint applies, so a redelivered suppressed event
     * collides here too and is ignored.
     */
    try {
      await prisma.notificationDelivery.create({
        data: {
          eventId: event.eventId,
          channel,
          userId: event.userId,
          notificationId: event.payload.notificationId,
          status: DeliveryStatus.SUPPRESSED,
          suppressReason: decision.reason,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        console.error(`[delivery] could not record suppression`, err);
      }
    }
    return { claimed: false, reason: "suppressed" };
  }

  try {
    const row = await prisma.notificationDelivery.create({
      data: {
        eventId: event.eventId,
        channel,
        userId: event.userId,
        notificationId: event.payload.notificationId,
        status: DeliveryStatus.PENDING,
        attempts: 1,
      },
      select: { id: true },
    });
    return { claimed: true, id: row.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      // NOT an error. A redelivery found the row from the first attempt.
      return { claimed: false, reason: "duplicate" };
    }
    console.error(`[delivery] could not claim ${event.eventId}/${channel}`, err);
    return { claimed: false, reason: "error" };
  }
}

/**
 * Thrown by a channel that has nothing to send TO.
 *
 * Distinct from a failure and distinct from a preference. Push is the case that
 * needs it: a user with no subscribed device is not a broken provider and not
 * somebody who opted out — they simply never turned it on in any browser.
 * Recording that as FAILED would fill the ledger with red for the ordinary
 * state of almost every account.
 */
export class NothingToDeliverTo extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NothingToDeliverTo";
  }
}

export async function markSuppressed(id: string, reason: string) {
  await prisma.notificationDelivery.update({
    where: { id },
    data: {
      status: DeliveryStatus.SUPPRESSED,
      suppressReason: reason,
      completedAt: new Date(),
    },
  });
}

/** The provider accepted it. */
export async function markSent(id: string, providerMessageId?: string | null) {
  await prisma.notificationDelivery.update({
    where: { id },
    data: {
      status: DeliveryStatus.SENT,
      providerMessageId: providerMessageId ?? null,
      completedAt: new Date(),
    },
  });
}

/**
 * The provider refused, or could not be reached.
 *
 * `permanent` separates a rejected address from a provider having a bad
 * minute. It is decided per failure, not per exception type — see ADR 0025 —
 * and it is what a retry ladder will read when there is one. Until phase 4
 * there is nothing to retry with, so both land as FAILED and the distinction is
 * recorded rather than acted on.
 */
export async function markFailed(
  id: string,
  err: unknown,
  permanent = false
): Promise<void> {
  const message = String(err instanceof Error ? err.message : err).slice(0, 500);
  await prisma.notificationDelivery.update({
    where: { id },
    data: {
      status: DeliveryStatus.FAILED,
      lastError: permanent ? `permanent: ${message}` : message,
      completedAt: new Date(),
    },
  });
}

/**
 * Runs a send under the ledger.
 *
 * Wraps the four steps so a channel consumer cannot get the order wrong — which
 * matters, because getting it wrong produces a bug that only appears under
 * redelivery and looks like the provider double-sending.
 *
 * NEVER THROWS. A channel that cannot deliver must not stop the others, and
 * under Kafka a throw here would prevent the offset commit and redeliver
 * forever. The outcome is on the row.
 */
export async function deliver(
  event: NotificationEvent,
  channel: DeliveryChannel,
  send: () => Promise<{ providerMessageId?: string | null }>
): Promise<"sent" | "duplicate" | "suppressed" | "failed"> {
  const c = await claim(event, channel);

  if (!c.claimed) {
    return c.reason === "suppressed" ? "suppressed" : "duplicate";
  }

  try {
    const result = await send();
    await markSent(c.id, result.providerMessageId);
    return "sent";
  } catch (err) {
    // Not a failure: there was nobody on this channel to send to. Recorded so
    // the row still answers "why did nothing arrive?", and not logged as an
    // error because for push it is the ordinary state of most accounts.
    if (err instanceof NothingToDeliverTo) {
      await markSuppressed(c.id, err.message);
      return "suppressed";
    }

    await markFailed(c.id, err);
    console.error(`[delivery] ${channel} failed for ${event.eventId}`, err);
    return "failed";
  }
}

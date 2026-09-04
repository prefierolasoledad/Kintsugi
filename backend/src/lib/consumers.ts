import type { NotificationEvent } from "./outbox";
import { emailConsumer } from "./consumers/email";
import { pushConsumer } from "./consumers/push";

/**
 * The channel consumers.
 *
 * Each is a plain async function. That is the whole point of the transport
 * seam: under NOTIFY_TRANSPORT=inline the relay calls these directly, and under
 * kafka each one becomes a consumer group reading the same topic. Identical
 * code on both paths, so the suite exercises the real handler and only the
 * broker is absent.
 *
 * WHAT IS HERE, AND WHAT IS NOT
 * Email (phase 2) and push (phase 3) are real. SMS is phase 4 and is NOT
 * stubbed here — there is no `smsConsumer` returning early, because a stub that
 * silently does nothing is indistinguishable from a channel that is broken.
 * When it lands it appears in this list; until then the honest state is that it
 * does not exist.
 *
 * EVERY CONSUMER GOES THROUGH deliveryLedger.deliver(). That is what resolves
 * preferences, claims the delivery, and settles the outcome — and it is the
 * only reason a redelivered event is not a second message. A consumer that
 * sends without it is a bug, not a shortcut.
 *
 * See docs/plans/0001-multi-channel-notifications.md.
 */

export type NotificationConsumer = {
  /** Becomes the Kafka consumer group id. Stable — changing it replays. */
  readonly group: string;
  handle(event: NotificationEvent): Promise<void>;
};

/**
 * Proves the pipeline end to end, and stays useful afterwards as the thing you
 * point at a topic to see what is actually flowing through it.
 */
export const logConsumer: NotificationConsumer = {
  group: "log-worker",
  async handle(event) {
    console.log(
      `[notify] ${event.type} → user ${event.userId} ` +
        `(event ${event.eventId}, ${event.aggregateType} ${event.aggregateId}) ` +
        `${JSON.stringify(event.payload.title)}`
    );
  },
};

export const CONSUMERS: NotificationConsumer[] = [logConsumer, emailConsumer, pushConsumer];

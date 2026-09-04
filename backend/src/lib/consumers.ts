import type { NotificationEvent } from "./outbox";

/**
 * The channel consumers.
 *
 * Each is a plain async function. That is the whole point of the transport
 * seam: under NOTIFY_TRANSPORT=inline the relay calls these directly, and under
 * kafka each one becomes a consumer group reading the same topic. Identical
 * code on both paths, so the suite exercises the real handler and only the
 * broker is absent.
 *
 * PHASE 1 HAS ONE CONSUMER, AND IT ONLY LOGS.
 * Email is phase 2, push phase 3, SMS phase 4. They are not stubbed here —
 * there is no `emailConsumer` returning early, because a stub that silently
 * does nothing is indistinguishable from a channel that is broken. When email
 * lands it appears in this list; until then the honest state is that one
 * consumer exists.
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

export const CONSUMERS: NotificationConsumer[] = [logConsumer];

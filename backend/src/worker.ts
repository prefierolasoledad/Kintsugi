import "dotenv/config";
import { CONSUMERS, type NotificationConsumer } from "./lib/consumers";
import { ensureTopics, kafka, TOPICS } from "./lib/kafka";
import { decodeEvent } from "./lib/outbox";
import { prisma } from "./lib/prisma";

/**
 * A channel worker: one Kafka consumer group per consumer.
 *
 * Consumer groups ARE the fan-out. One topic, N groups, each getting every
 * message and tracking its own offsets — so adding a channel is a new group and
 * no producer change at all. See docs/adr/0025-kafka-topics-and-partitioning.md
 *
 * Run all consumers in one process, or one per process:
 *
 *   node dist/worker.js               every consumer group
 *   node dist/worker.js log-worker    just that one
 *
 * One per process is what a real deployment does, because it is what lets email
 * and SMS scale independently — which is most of why a broker is here at all.
 */

/**
 * OFFSETS ARE COMMITTED BY HAND, AFTER THE HANDLER RETURNS.
 *
 * With autoCommit on, the offset advances on a timer regardless of whether the
 * handler finished, so a consumer that dies mid-send has already recorded the
 * message as done and it is never retried — a silently dropped notification.
 *
 * Committing after the handler inverts the failure: a crash between the send
 * and the commit redelivers, which is a duplicate rather than a loss. That is
 * the trade this pipeline makes everywhere, and it is only safe because the
 * delivery ledger deduplicates on eventId.
 * See docs/adr/0026-delivery-idempotency.md
 */
async function runConsumer(consumer: NotificationConsumer): Promise<void> {
  const client = kafka(`kintsugi-${consumer.group}`);
  const kc = client.consumer({
    kafkaJS: {
      groupId: consumer.group,
      autoCommit: false,
      allowAutoTopicCreation: false,
      fromBeginning: true,
    },
  });

  await kc.connect();
  await kc.subscribe({ topics: [TOPICS.main] });

  console.log(`[worker] ${consumer.group} subscribed to ${TOPICS.main}`);

  await kc.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = decodeEvent(message.value);

      if (!event) {
        /**
         * A poison pill. Committed past deliberately: rethrowing would stall
         * this partition forever on one unreadable message, which is a far
         * worse outcome than losing it. Logged loudly because it should never
         * happen — the only producer is our own relay.
         */
        console.error(
          `[worker] ${consumer.group}: undecodable message at ` +
            `${topic}/${partition}/${message.offset}, skipping`
        );
      } else {
        await consumer.handle(event);
      }

      // Kafka's next-offset convention: commit the offset AFTER this one.
      await kc.commitOffsets([
        { topic, partition, offset: String(Number(message.offset) + 1) },
      ]);
    },
  });

  const shutdown = async () => {
    console.log(`\n[worker] ${consumer.group} disconnecting`);
    try {
      await kc.disconnect();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

async function main() {
  if (process.env.NOTIFY_TRANSPORT?.trim().toLowerCase() !== "kafka") {
    console.error(
      "\nConfiguration error:\n" +
        "  The worker only runs under NOTIFY_TRANSPORT=kafka.\n" +
        "  With inline transport the relay calls the consumers directly and\n" +
        "  there is nothing here to consume.\n"
    );
    process.exit(1);
  }

  const requested = process.argv[2];
  const selected = requested
    ? CONSUMERS.filter((c) => c.group === requested)
    : CONSUMERS;

  if (selected.length === 0) {
    console.error(
      `\nUnknown consumer "${requested}". Available: ` +
        `${CONSUMERS.map((c) => c.group).join(", ")}\n`
    );
    process.exit(1);
  }

  await ensureTopics("kintsugi-worker-admin");
  await Promise.all(selected.map(runConsumer));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});

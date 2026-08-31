import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import {
  cachedUnreadCount,
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
  removeNotification,
} from "../lib/notifications";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

function fail(res: import("express").Response, err: unknown, fallback: string) {
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

const query = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

notificationsRouter.get("/", async (req, res) => {
  try {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Check the request.", code: "INVALID_INPUT" });
    }

    const [notifications, unread] = await Promise.all([
      listNotifications(req.userId!, {
        unreadOnly: parsed.data.unread === "true",
        take: parsed.data.limit,
      }),
      countUnread(req.userId!),
    ]);

    res.json({ notifications, unread });
  } catch (err) {
    fail(res, err, "Could not load your notifications.");
  }
});

/**
 * Just the count, for the nav bell.
 *
 * Separate from GET / because the bell renders on every page and has no use for
 * fifty rows of text it will not display.
 */
notificationsRouter.get("/count", async (req, res) => {
  try {
    // The cached variant, and the only place that uses it — this is the one
    // endpoint every open tab polls on a timer. See lib/notifications.ts.
    res.json({ unread: await cachedUnreadCount(req.userId!) });
  } catch (err) {
    fail(res, err, "Could not count your notifications.");
  }
});

notificationsRouter.post("/:id/read", async (req, res) => {
  try {
    await markRead(req.userId!, req.params.id);
    // Already-read is a success. Opening the same thing twice is normal, and an
    // error there would be noise rather than information.
    res.json({ unread: await countUnread(req.userId!) });
  } catch (err) {
    fail(res, err, "Could not update that notification.");
  }
});

notificationsRouter.post("/read-all", async (req, res) => {
  try {
    const count = await markAllRead(req.userId!);
    res.json({ marked: count, unread: 0 });
  } catch (err) {
    fail(res, err, "Could not update your notifications.");
  }
});

notificationsRouter.delete("/:id", async (req, res) => {
  try {
    await removeNotification(req.userId!, req.params.id);
    res.status(204).end();
  } catch (err) {
    fail(res, err, "Could not remove that notification.");
  }
});

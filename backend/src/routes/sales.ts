import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { requireSeller } from "../middleware/requireSeller";
import {
  SalesError,
  getSale,
  listSales,
  markShipped,
  markUnfulfillable,
  salesSummary,
} from "../lib/sales";

/**
 * A seller's own sales.
 *
 * Mounted under /seller, so requireSeller already guarantees req.sellerId. Every
 * query below is scoped to it — a seller can only ever see and act on lines they
 * sold, and a line belonging to someone else is a 404 rather than a 403.
 */
export const salesRouter = Router();

salesRouter.use(requireAuth, requireSeller);

function fail(res: import("express").Response, err: unknown, fallback: string) {
  if (err instanceof SalesError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

const filters = z.enum(["all", "to_send", "sent"]).default("all");

salesRouter.get("/sales", async (req, res) => {
  try {
    const filter = filters.safeParse(req.query.filter ?? "all");
    if (!filter.success) {
      return res.status(400).json({ error: "Unknown filter.", code: "INVALID_INPUT" });
    }

    const [sales, summary] = await Promise.all([
      listSales(req.sellerId!, filter.data),
      salesSummary(req.sellerId!),
    ]);

    res.json({ sales, summary });
  } catch (err) {
    fail(res, err, "Could not load your sales.");
  }
});

salesRouter.get("/sales/:id", async (req, res) => {
  try {
    const sale = await getSale(req.sellerId!, req.params.id);
    if (!sale) return res.status(404).json({ error: "Sale not found.", code: "NOT_FOUND" });
    res.json({ sale });
  } catch (err) {
    fail(res, err, "Could not load that sale.");
  }
});

const shipBody = z.object({
  // Both optional: plenty of secondhand sales are handed over in person or
  // posted without a trackable service, and demanding a number would push
  // sellers into inventing one.
  carrier: z.string().trim().max(80).nullish(),
  trackingNumber: z.string().trim().max(120).nullish(),
});

salesRouter.post("/sales/:id/ship", async (req, res) => {
  try {
    const parsed = shipBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Check those details.", code: "INVALID_INPUT" });
    }

    const sale = await markShipped({
      sellerId: req.sellerId!,
      orderItemId: req.params.id,
      carrier: parsed.data.carrier ?? null,
      trackingNumber: parsed.data.trackingNumber ?? null,
    });
    res.json({ sale });
  } catch (err) {
    fail(res, err, "Could not mark that as sent.");
  }
});

const cannotSendBody = z.object({
  reason: z.string().trim().min(1, "Tell the buyer why.").max(500),
});

salesRouter.post("/sales/:id/cannot-send", async (req, res) => {
  try {
    const parsed = cannotSendBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Tell the buyer why.", code: "INVALID_INPUT", field: "reason" });
    }

    const result = await markUnfulfillable({
      sellerId: req.sellerId!,
      orderItemId: req.params.id,
      reason: parsed.data.reason,
    });

    res.json({
      ok: true,
      /**
       * The refund outcome, reported rather than assumed.
       *
       * This used to return `refundOwed: true` and a note admitting refunds
       * were not built. They are now issued in the same operation — but a
       * provider can still refuse, so the seller is told which happened
       * instead of being reassured either way.
       */
      refunded: result.refunded,
      refundCents: result.refundCents,
      refundStatus: result.refundStatus,
      refundError: result.refundError,
      note: result.refunded
        ? "The buyer has been refunded automatically."
        : result.refundError
          ? "The buyer was told, but the refund did not go through — it is recorded for someone to settle."
          : "Nothing to refund: this order was never paid for.",
    });
  } catch (err) {
    fail(res, err, "Could not update that sale.");
  }
});

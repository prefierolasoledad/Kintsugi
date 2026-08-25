import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { UPLOAD_DIR } from "./lib/storage";
import { authRouter } from "./routes/auth";
import { catalogRouter } from "./routes/catalog";
import { sellerRouter } from "./routes/seller";
import { profileRouter } from "./routes/profile";
import { startOrderSweeper } from "./lib/orders";
import { assertKycConfigured } from "./lib/kycProvider";
import { assertProviderConfigured } from "./lib/paymentProvider";
import { startReservationSweeper } from "./lib/reservations";
import { ordersRouter } from "./routes/orders";
import { reservationsRouter } from "./routes/reservations";
import { reviewsRouter } from "./routes/reviews";
import { sellerVerificationRouter } from "./routes/sellerVerification";
import { webhooksRouter } from "./routes/webhooks";
import { wishlistRouter } from "./routes/wishlist";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

/**
 * Mounted BEFORE express.json(), because Stripe signs the raw request bytes.
 * If the JSON parser reaches the body first, it is re-serialised and every
 * signature check fails. This is the single most common way webhook
 * verification gets broken, so the ordering here is load-bearing.
 *
 * No CSRF concern: webhooks are cookie-less and authenticated by signature.
 */
app.use("/webhooks", webhooksRouter);

app.use(express.json());
app.use(cookieParser());

/**
 * Uploaded images. Keys are random and never reused, so a long immutable cache
 * is safe. `dotfiles: deny` and `index: false` keep this from serving anything
 * other than the files we wrote.
 */
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    maxAge: "1y",
    immutable: true,
    index: false,
    dotfiles: "deny",
    fallthrough: false,
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "kintsugi-backend" });
});

app.use("/auth", authRouter);
app.use("/catalog", catalogRouter);
app.use("/profile", profileRouter);
app.use("/reservations", reservationsRouter);
app.use("/orders", ordersRouter);
app.use("/wishlist", wishlistRouter);
app.use("/reviews", reviewsRouter);
// Verification is mounted first so its routes aren't shadowed by the listing
// router's own paths.
app.use("/seller", sellerVerificationRouter);
app.use("/seller", sellerRouter);

/**
 * Fail before binding the port, not at the first checkout. A missing Stripe key
 * discovered mid-payment is one broken customer; discovered here it is a
 * one-line startup error.
 */
let paymentSummary: string;
let kycSummary: string;
try {
  paymentSummary = assertProviderConfigured();
  kycSummary = assertKycConfigured();
} catch (err) {
  console.error(`\nConfiguration error:\n  ${(err as Error).message}\n`);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Kintsugi backend listening on http://localhost:${PORT}`);
  console.log(`Payments: ${paymentSummary}`);
  console.log(`Identity: ${kycSummary}`);

  // Expired holds must be returned to stock by something other than a new
  // reservation attempt: a fully-held listing is hidden from the catalog, so no
  // buyer can trigger the lazy reclaim for it.
  startReservationSweeper();

  // Two jobs, same reasoning as above — both recover state that nothing in the
  // request path can reach:
  //   unpaid orders hold stock, and their listing is hidden from the catalog
  //   in-flight payments whose request died need settling against the provider
  startOrderSweeper();
});

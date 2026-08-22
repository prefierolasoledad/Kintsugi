import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { UPLOAD_DIR } from "./lib/storage";
import { authRouter } from "./routes/auth";
import { catalogRouter } from "./routes/catalog";
import { sellerRouter } from "./routes/seller";
import { sellerVerificationRouter } from "./routes/sellerVerification";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
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
// Verification is mounted first so its routes aren't shadowed by the listing
// router's own paths.
app.use("/seller", sellerVerificationRouter);
app.use("/seller", sellerRouter);

app.listen(PORT, () => {
  console.log(`Kintsugi backend listening on http://localhost:${PORT}`);
});

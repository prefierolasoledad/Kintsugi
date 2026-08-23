import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  MAX_AVATAR_BYTES,
  UploadError,
  processAvatarUpload,
} from "../lib/imageProcessing";
import { prisma } from "../lib/prisma";
import { checkRateLimit } from "../lib/rateLimit";
import { keyFromUrl, newKey, putFile, removeFile } from "../lib/storage";
import { requireAuth } from "../middleware/requireAuth";

/**
 * Profile picture management.
 *
 * The image is written to object storage and only its URL is kept on the user
 * row. Storing image bytes in Postgres would bloat backups, defeat CDN caching,
 * and put binary data through the connection pool on every read — which is why
 * no production system does it.
 * See docs/adr/0011-avatars-in-object-storage.md
 */
export const profileRouter = Router();

profileRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
});

function singleAvatar(req: Request, res: Response, next: NextFunction) {
  upload.single("avatar")(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      res.status(400).json({
        error:
          code === "LIMIT_FILE_SIZE"
            ? "Profile picture must be 5MB or smaller."
            : "Could not read that upload.",
        code: "UPLOAD_FAILED",
      });
      return;
    }
    next();
  });
}

/** Removes the previous file so replacing an avatar doesn't orphan storage. */
async function deleteStoredAvatar(url: string | null) {
  if (!url) return;
  const key = keyFromUrl(url);
  if (key) await removeFile(key);
}

profileRouter.post("/avatar", singleAvatar, async (req, res) => {
  try {
    const limit = checkRateLimit(`avatar:${req.userId}`, 10, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "Too many changes for now. Try again shortly.",
        code: "RATE_LIMITED",
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image was attached.", code: "NO_FILE" });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { avatarUrl: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Account not found." });
    }

    const processed = await processAvatarUpload(req.file.buffer);
    const url = await putFile(newKey(processed.ext), processed.data);

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: url },
      select: {
        id: true,
        name: true,
        email: true,
        isSeller: true,
        emailVerified: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    // Only after the new URL is committed, so a failed write never leaves the
    // user with no picture at all.
    await deleteStoredAvatar(existing.avatarUrl);

    res.json({ user });
  } catch (err) {
    if (err instanceof UploadError) {
      return res.status(400).json({ error: err.message, code: "INVALID_IMAGE" });
    }
    console.error("POST /profile/avatar failed", err);
    res.status(500).json({ error: "Could not save that picture." });
  }
});

profileRouter.delete("/avatar", async (req, res) => {
  try {
    const existing = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { avatarUrl: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Account not found." });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: null },
      select: {
        id: true,
        name: true,
        email: true,
        isSeller: true,
        emailVerified: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    await deleteStoredAvatar(existing.avatarUrl);

    res.json({ user });
  } catch (err) {
    console.error("DELETE /profile/avatar failed", err);
    res.status(500).json({ error: "Could not remove that picture." });
  }
});

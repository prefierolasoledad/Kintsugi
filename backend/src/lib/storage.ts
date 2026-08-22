import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

/**
 * Local-disk file storage.
 *
 * Everything above this module only knows `put`/`remove` and a public URL, so
 * moving to S3/R2/Cloudinary later means reimplementing these two functions and
 * nothing else. Local disk is correct for development but does not survive a
 * container restart, which is why the swap point exists.
 */

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

const PUBLIC_BASE =
  process.env.PUBLIC_UPLOAD_BASE ?? `http://localhost:${process.env.PORT ?? 4000}/uploads`;

/** Keys are server-generated, so a key that doesn't match is never ours. */
const KEY_PATTERN = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

export function newKey(ext: string): string {
  return `${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

export function publicUrl(key: string): string {
  return `${PUBLIC_BASE}/${key}`;
}

export async function putFile(key: string, data: Buffer): Promise<string> {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Refusing to write malformed storage key: ${key}`);
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, key), data);
  return publicUrl(key);
}

/**
 * Best-effort delete. A missing file is not an error — the DB row is the source
 * of truth, and a leftover orphan is harmless compared to failing the request.
 */
export async function removeFile(key: string): Promise<void> {
  if (!KEY_PATTERN.test(key)) return;
  await fs.rm(path.join(UPLOAD_DIR, key), { force: true });
}

/** Recovers the storage key from a stored public URL, or null if not ours. */
export function keyFromUrl(url: string): string | null {
  const last = url.split("/").pop();
  return last && KEY_PATTERN.test(last) ? last : null;
}

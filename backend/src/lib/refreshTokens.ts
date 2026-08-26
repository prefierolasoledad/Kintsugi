import { prisma } from "./prisma";
import { generateRefreshToken, hashToken, REFRESH_TOKEN_MAX_AGE_MS } from "./auth";

export async function issueRefreshToken(userId: string) {
  const token = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS),
    },
  });
  return token;
}

export type RotateResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: "not_found" | "expired" | "reused" };

/**
 * Rotates a refresh token: the presented token is marked used and a new one
 * is issued in its place. If the presented token was already rotated once
 * before, that's a signal it was stolen and replayed after the legitimate
 * client moved on — every token for that user is revoked in response.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!record) {
    return { ok: false, reason: "not_found" };
  }

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "reused" };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  const newToken = generateRefreshToken();
  const newTokenHash = hashToken(newToken);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedByTokenHash: newTokenHash },
    }),
    prisma.refreshToken.create({
      data: {
        userId: record.userId,
        tokenHash: newTokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_MS),
      },
    }),
  ]);

  return { ok: true, userId: record.userId, token: newToken };
}

/**
 * Revokes every live refresh token for a user.
 *
 * Called whenever the password changes, by either route. A password change is
 * the standard response to "somebody else may be in my account", and it is
 * worthless if the intruder's session keeps working — they would simply keep
 * refreshing, and the owner would have locked out nobody.
 *
 * `except` keeps the caller's own session alive, so changing your password from
 * the settings page does not sign you out of the tab you are using. A reset
 * passes nothing, because there is no session to preserve and the whole point
 * is that every existing one dies.
 */
export async function revokeAllRefreshTokens(userId: string, except?: string) {
  const { count } = await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(except ? { tokenHash: { not: hashToken(except) } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function revokeRefreshToken(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

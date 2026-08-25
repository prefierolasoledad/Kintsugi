import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
// otplib v13 dropped the `authenticator` singleton for standalone functions.
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import type { Response } from "express";
import { prisma } from "./prisma";
import { UserRole } from "../generated/prisma/enums";

/**
 * Admin authentication — deliberately a second, separate thing.
 *
 * WHY SIGNING IN NORMALLY DOES NOT OPEN THE PANEL
 * The two most common ways an admin panel gets reached are a stolen storefront
 * session and a compromised email inbox (password reset → account → admin).
 * Both stop short here: the shopping session carries no admin rights at all,
 * and re-authentication requires a factor that email cannot provide.
 *
 * So there are two sessions. The ordinary one lasts weeks and lets you buy a
 * chair. The admin one lasts thirty minutes, needs the password again plus a
 * TOTP code, and is signed with a different secret so one cannot be forged from
 * the other.
 *
 * WHAT THIS IS NOT
 * Not SSO. Real companies put staff behind an identity provider with enforced
 * MFA and deprovisioning tied to HR — that is the actual industry standard, and
 * it needs an IdP this project does not have. This is the strongest thing
 * buildable without one, and the gap is recorded rather than hidden.
 */

const ADMIN_COOKIE = "kintsugi_admin";

/** Thirty minutes. Long enough to work through a report queue, short enough
 *  that a forgotten open tab is not a standing invitation. */
const ADMIN_SESSION_MS = 30 * 60 * 1000;

/**
 * A distinct secret, derived from JWT_SECRET rather than configured separately.
 *
 * Separate so an ordinary access token can never be replayed as an admin token
 * even if the signing code is confused. Derived so there is not a second
 * environment variable to forget to set — a missing admin secret that silently
 * fell back to the main one would be worse than no separation at all.
 */
function adminSecret(): string {
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET is not set");
  return crypto.createHmac("sha256", base).update("kintsugi:admin:v1").digest("hex");
}

export type AdminClaims = { sub: string; kind: "admin" };

export function mintAdminToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: "admin" } satisfies AdminClaims, adminSecret(), {
    expiresIn: Math.floor(ADMIN_SESSION_MS / 1000),
  });
}

export function readAdminToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, adminSecret()) as AdminClaims;
    // Belt and braces: the secret already makes cross-use impossible, but an
    // explicit kind check means a future change cannot quietly reopen it.
    if (claims.kind !== "admin") return null;
    return claims.sub;
  } catch {
    return null;
  }
}

/**
 * Seconds left on an admin session, read from the token's own `exp`.
 *
 * Taken from the token rather than counted down by the browser so the number
 * the panel shows is the number the server will actually enforce. A client-side
 * timer started at sign-in drifts, survives a reload it should not, and would
 * cheerfully promise ten more minutes to a session already expired.
 */
export function adminTokenSecondsLeft(token: string | undefined): number {
  if (!token) return 0;
  try {
    const claims = jwt.verify(token, adminSecret()) as AdminClaims & { exp?: number };
    if (!claims.exp) return 0;
    return Math.max(0, claims.exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

export function setAdminCookie(res: Response, token: string) {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_SESSION_MS,
    /**
     * Not path-scoped to /admin, deliberately.
     *
     * The browser talks to the Next BFF at /api/admin/*, not to this server at
     * /admin/*, so a path scope would stop the cookie ever being sent. The
     * separation is carried by the distinct name, the distinct secret, and the
     * short lifetime instead.
     */
  });
}

export function clearAdminCookie(res: Response) {
  res.clearCookie(ADMIN_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

export const ADMIN_COOKIE_NAME = ADMIN_COOKIE;
export const ADMIN_SESSION_SECONDS = Math.floor(ADMIN_SESSION_MS / 1000);

/* ------------------------------------------------------------------ *
 * TOTP
 * ------------------------------------------------------------------ */

/**
 * Accept the previous and next 30-second step.
 *
 * Phone clocks drift, and someone typing a six-digit code can straddle a
 * boundary. One step either side is the usual compromise: it widens the
 * acceptance window to about 90 seconds, which is still nowhere near
 * brute-forceable given the rate limit on the step-up endpoint.
 */
const EPOCH_TOLERANCE = 1;

export function generateTotpSecret() {
  return generateSecret();
}

/** The otpauth:// URI an authenticator app scans, plus a QR to render. */
export async function totpEnrolment(email: string, secret: string) {
  const uri = generateURI({
    issuer: "Kintsugi Admin",
    // The label is what shows in the app's list, so it names the account
    // rather than leaving someone guessing which entry this is.
    label: email,
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 240, margin: 1 });
  return { uri, qrDataUrl, secret };
}

export function verifyTotp(secret: string, token: string) {
  try {
    const result = verifySync({
      secret,
      // Authenticator apps display codes in groups; people paste them that way.
      token: token.replace(/\s/g, ""),
      epochTolerance: EPOCH_TOLERANCE,
    });
    return result.valid === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * The step-up itself
 * ------------------------------------------------------------------ */

export class AdminAuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.name = "AdminAuthError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Exchanges password + TOTP for an admin session.
 *
 * Requires an already-signed-in user: this is a step-up, not a second front
 * door. Someone who is not logged in has nothing to step up from.
 */
export async function stepUp(input: {
  userId: string;
  password: string;
  totpCode: string;
}): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      role: true,
      passwordHash: true,
      suspendedAt: true,
      totpSecret: true,
      totpConfirmedAt: true,
    },
  });

  /**
   * One message for every failure below.
   *
   * A distinct "you are not an admin" would turn this endpoint into an oracle
   * for enumerating which accounts have admin rights, which is precisely the
   * list an attacker wants.
   */
  const refuse = () => {
    throw new AdminAuthError("ADMIN_AUTH_FAILED", "That didn't work.", 401);
  };

  if (!user) refuse();
  if (user!.role !== UserRole.ADMIN) refuse();
  if (user!.suspendedAt) refuse();

  const passwordOk = await bcrypt.compare(input.password, user!.passwordHash);
  if (!passwordOk) refuse();

  if (!user!.totpSecret || !user!.totpConfirmedAt) {
    // Distinct on purpose: this one is reachable only after the password has
    // already been proven, so it leaks nothing to an outsider — and without it
    // an admin who has not enrolled would be permanently stuck.
    throw new AdminAuthError(
      "TOTP_NOT_SET_UP",
      "Set up two-factor authentication before using the admin panel.",
      403
    );
  }

  if (!verifyTotp(user!.totpSecret, input.totpCode)) refuse();

  return mintAdminToken(user!.id);
}

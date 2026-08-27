import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  clearAuthCookies,
  getRefreshTokenCookie,
  hashPassword,
  setAuthCookies,
  signAccessToken,
  verifyPassword,
} from "../lib/auth";
import {
  consumeEmailVerificationToken,
  issueAndSendVerificationEmail,
} from "../lib/emailVerification";
import { isPasswordBreached } from "../lib/passwordBreach";
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken } from "../lib/refreshTokens";
import { requireAuth } from "../middleware/requireAuth";
import { checkRateLimit } from "../lib/rateLimit";
import {
  PasswordError,
  changePassword,
  requestPasswordReset,
  resetPassword,
} from "../lib/passwordReset";

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const tokenSchema = z.object({
  token: z.string().min(1, "Missing token"),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  isSeller: boolean;
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isSeller: user.isSeller,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

async function issueSession(res: import("express").Response, userId: string) {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId }),
    issueRefreshToken(userId),
  ]);
  setAuthCookies(res, { accessToken, refreshToken });
}

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? "Invalid input", field: issue?.path[0] });
    return;
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.emailVerified) {
    res.status(409).json({ error: "An account with that email already exists", field: "email" });
    return;
  }

  if (await isPasswordBreached(password)) {
    res.status(400).json({
      error: "This password has appeared in a known data breach. Please choose a different one.",
      field: "password",
    });
    return;
  }

  const passwordHash = await hashPassword(password);

  // An unverified account already exists for this email — treat this as a
  // fresh signup rather than a dead-end 409, so a lost/expired email isn't
  // a trap. Update the name/password too, in case they were retrying with
  // a different password than the first attempt.
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash } })
    : await prisma.user.create({ data: { name, email, passwordHash } });

  await issueAndSendVerificationEmail(user.id, user.email);
  res.status(201).json({
    message: "Check your email to verify your account before logging in.",
    email: user.email,
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? "Invalid input", field: issue?.path[0] });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !valid) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }

  /**
   * Suspension is checked after the password, deliberately.
   *
   * Checking first would turn login into an oracle for which accounts are
   * suspended, without anyone needing to know the password. The reason is
   * included because a vague refusal is indistinguishable from a bug, and
   * generates support instead of preventing it.
   */
  if (user.suspendedAt) {
    res.status(403).json({
      error: user.suspendedReason
        ? `This account is suspended. ${user.suspendedReason}`
        : "This account is suspended.",
      code: "ACCOUNT_SUSPENDED",
    });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({
      error: "Please verify your email before logging in.",
      code: "EMAIL_NOT_VERIFIED",
    });
    return;
  }

  await issueSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/verify-email", async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const userId = await consumeEmailVerificationToken(parsed.data.token);
  if (!userId) {
    res.status(400).json({ error: "This verification link is invalid or has expired." });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(400).json({ error: "This verification link is invalid or has expired." });
    return;
  }

  await issueSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/resend-verification", async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && !user.emailVerified) {
    await issueAndSendVerificationEmail(user.id, user.email);
  }

  // Same response whether or not the account exists or is already
  // verified — otherwise this endpoint would let anyone probe which emails
  // are registered.
  res.json({ message: "If that email needs verification, we've sent a new link." });
});

authRouter.post("/refresh", async (req, res) => {
  const refreshToken = getRefreshTokenCookie(req);
  if (!refreshToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const result = await rotateRefreshToken(refreshToken);
  if (!result.ok) {
    clearAuthCookies(res);
    res.status(401).json({ error: "Session expired, please log in again" });
    return;
  }

  const accessToken = signAccessToken({ userId: result.userId });
  setAuthCookies(res, { accessToken, refreshToken: result.token });
  res.status(204).end();
});

authRouter.post("/logout", async (req, res) => {
  const refreshToken = getRefreshTokenCookie(req);
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
  clearAuthCookies(res);
  res.status(204).end();
});

/* ================================================================== *
 * Passwords
 * ================================================================== */

function failPassword(res: import("express").Response, err: unknown, fallback: string) {
  if (err instanceof PasswordError) {
    return res
      .status(err.status)
      .json({ error: err.message, code: err.code, ...(err.field ? { field: err.field } : {}) });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(1, "Enter a new password"),
});

/**
 * Change your password while signed in.
 *
 * Requires the current password even though the session is already valid — a
 * stolen cookie must not be enough to take the account permanently.
 */
authRouter.post("/password/change", requireAuth, async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        error: issue?.message ?? "Invalid input",
        code: "INVALID_INPUT",
        field: issue?.path[0],
      });
    }

    // Rate limited on the CURRENT password check, which is a password oracle
    // for anyone holding a stolen session and guessing.
    const limit = await checkRateLimit(`password-change:${req.userId}`, 10, 15 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "Too many attempts. Wait a few minutes.",
        code: "RATE_LIMITED",
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const result = await changePassword({
      userId: req.userId!,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      // Their own session survives; everything else is revoked.
      keepRefreshToken: getRefreshTokenCookie(req),
    });

    res.json({
      ok: true,
      otherSessionsEnded: result.otherSessionsEnded,
      message:
        result.otherSessionsEnded > 0
          ? `Password changed. ${result.otherSessionsEnded} other session${
              result.otherSessionsEnded === 1 ? " was" : "s were"
            } signed out.`
          : "Password changed.",
    });
  } catch (err) {
    failPassword(res, err, "Could not change your password.");
  }
});

/**
 * Ask for a reset link.
 *
 * Always 200, whether or not the address is registered — anything else is an
 * account-enumeration oracle. Same reasoning as /auth/resend-verification.
 */
authRouter.post("/password/forgot", async (req, res) => {
  try {
    const parsed = emailSchema.safeParse(req.body ?? {});
    // Even a malformed address gets the same answer, so probing with junk
    // cannot be distinguished from probing with real addresses.
    if (!parsed.success) {
      return res.json({ message: "If that address has an account, a reset link is on its way." });
    }

    /**
     * Rate limited per address AND per caller.
     *
     * Per address, because otherwise this endpoint will mail somebody's inbox
     * as fast as it can be called — harassment, and a fast route to being
     * marked as spam. Per IP, because otherwise one caller can do that to a
     * long list of addresses instead.
     */
    const perEmail = await checkRateLimit(`forgot:${parsed.data.email}`, 3, 60 * 60 * 1000);
    const perCaller = await checkRateLimit(`forgot-ip:${req.ip}`, 20, 60 * 60 * 1000);

    if (perEmail.allowed && perCaller.allowed) {
      await requestPasswordReset(parsed.data.email);
    }

    // Note the response does not change when rate limited either. A 429 here
    // would say "this address is real and somebody keeps asking".
    res.json({ message: "If that address has an account, a reset link is on its way." });
  } catch (err) {
    // Even a genuine failure answers the same way, and is logged rather than
    // returned. The alternative leaks which addresses exist via error shape.
    console.error("Password reset request failed", err);
    res.json({ message: "If that address has an account, a reset link is on its way." });
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Missing token"),
  newPassword: z.string().min(1, "Enter a new password"),
});

/** Redeem a reset link. Single-use, one hour, and it ends every session. */
authRouter.post("/password/reset", async (req, res) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        error: issue?.message ?? "Invalid input",
        code: "INVALID_INPUT",
        field: issue?.path[0],
      });
    }

    /**
     * A courtesy cap, not a guessing control.
     *
     * Tokens are 256 bits of randomness, so this endpoint cannot be brute
     * forced no matter how many attempts are allowed. Nor is it an expensive
     * one to abuse: an invalid token costs a SHA-256 and one indexed lookup and
     * returns before any bcrypt or breach-list call happens. Only a genuine
     * token reaches the costly work, and a genuine token can be used once.
     *
     * So the limit exists to stop somebody hammering the endpoint, and nothing
     * more. It was 20/hour, which is tight enough to bite a corporate NAT where
     * many people share one egress address — and, less importantly but more
     * visibly, tight enough that running the test suite twice in an hour
     * exhausted it. Raised to a figure that still caps abuse without punishing
     * shared addresses.
     */
    const limit = await checkRateLimit(`reset-ip:${req.ip}`, 100, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({ error: "Too many attempts.", code: "RATE_LIMITED" });
    }

    await resetPassword({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });

    /**
     * No session is issued.
     *
     * They are sent to the login page to use the password they just chose.
     * Signing them in directly would mean a reset link is a one-click login,
     * and links leak — forwarded mail, shared screens, scanners that follow
     * URLs. Making them type it also confirms they know what they set.
     */
    clearAuthCookies(res);
    res.json({ ok: true, message: "Password changed. Sign in with your new password." });
  } catch (err) {
    failPassword(res, err, "Could not reset your password.");
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ user: publicUser(user) });
});

authRouter.post("/become-seller", requireAuth, async (req, res) => {
  const userId = req.userId!;

  // The flag and the profile have to move together. A user with isSeller but no
  // SellerProfile could not own a listing, and a profile without the flag would
  // be invisible to the UI — so both happen in one transaction or neither does.
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { isSeller: true },
    });

    await tx.sellerProfile.upsert({
      where: { userId },
      update: {},
      create: { userId, shopName: updated.name },
    });

    return updated;
  });

  res.json({ user: publicUser(user) });
});

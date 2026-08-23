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

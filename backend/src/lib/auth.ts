import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (!JWT_SECRET_ENV) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = JWT_SECRET_ENV;

const SESSION_COOKIE = "kintsugi_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionPayload = {
  userId: string;
};

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: import("express").Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionCookie(req: import("express").Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}

import type { NextFunction, Request, Response } from "express";
import { getSessionCookie, verifySession } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getSessionCookie(req);
  const session = token ? verifySession(token) : null;

  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.userId = session.userId;
  next();
}

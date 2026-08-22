import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

// Paths that legitimately return 401 on their own (bad credentials, no
// session yet, or the refresh call itself) — retrying these through the
// refresh flow would be wrong or would loop.
const NO_REFRESH_RETRY = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/refresh",
  "/auth/verify-email",
  "/auth/resend-verification",
]);

function parseCookieHeader(header: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return map;
}

function applySetCookies(cookieHeader: string, setCookies: string[]): string {
  const map = parseCookieHeader(cookieHeader);
  for (const setCookie of setCookies) {
    const firstPair = setCookie.split(";")[0];
    const eq = firstPair.indexOf("=");
    if (eq === -1) continue;
    map.set(firstPair.slice(0, eq).trim(), firstPair.slice(eq + 1).trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function callBackend(backendPath: string, method: string, cookieHeader: string, body: string | null) {
  const res = await fetch(`${BACKEND_URL}${backendPath}`, {
    method,
    headers: { "Content-Type": "application/json", cookie: cookieHeader },
    body: body ?? undefined,
  });
  const text = res.status === 204 ? null : await res.text();
  return { status: res.status, contentType: res.headers.get("content-type"), body: text, setCookies: res.headers.getSetCookie() };
}

export async function proxyToBackend(req: NextRequest, backendPath: string) {
  const originalCookieHeader = req.headers.get("cookie") ?? "";
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.text();

  let result = await callBackend(backendPath, req.method, originalCookieHeader, body);
  let extraSetCookies: string[] = [];

  if (result.status === 401 && !NO_REFRESH_RETRY.has(backendPath)) {
    const refresh = await callBackend("/auth/refresh", "POST", originalCookieHeader, null);

    if (refresh.status === 204 && refresh.setCookies.length > 0) {
      const retryCookieHeader = applySetCookies(originalCookieHeader, refresh.setCookies);
      result = await callBackend(backendPath, req.method, retryCookieHeader, body);
      extraSetCookies = refresh.setCookies;
    }
  }

  const res = new NextResponse(result.body, {
    status: result.status,
    headers: { "Content-Type": result.contentType ?? "application/json" },
  });

  for (const cookie of [...extraSetCookies, ...result.setCookies]) {
    res.headers.append("set-cookie", cookie);
  }

  return res;
}

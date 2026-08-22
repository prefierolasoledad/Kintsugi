import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export async function proxyToBackend(req: NextRequest, backendPath: string) {
  const init: RequestInit = {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") ?? "",
    },
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  const backendRes = await fetch(`${BACKEND_URL}${backendPath}`, init);
  const resBody = backendRes.status === 204 ? null : await backendRes.text();

  const res = new NextResponse(resBody, {
    status: backendRes.status,
    headers: {
      "Content-Type": backendRes.headers.get("content-type") ?? "application/json",
    },
  });

  for (const cookie of backendRes.headers.getSetCookie()) {
    res.headers.append("set-cookie", cookie);
  }

  return res;
}

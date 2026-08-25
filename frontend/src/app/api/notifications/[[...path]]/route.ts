import type { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backendProxy";

/**
 * Optional catch-all so `/api/notifications`, `/api/notifications/count`,
 * `/api/notifications/read-all` and `/api/notifications/:id/read` all land here.
 */
async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await ctx.params;
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join("/")}` : "";
  return proxyToBackend(req, `/notifications${suffix}${req.nextUrl.search}`);
}

export { handler as GET, handler as POST, handler as DELETE };

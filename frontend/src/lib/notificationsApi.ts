import { ApiError } from "@/lib/api";

export type NotificationType =
  | "SALE_MADE"
  | "ORDER_SHIPPED"
  | "ORDER_DELIVERED"
  | "ORDER_UNFULFILLABLE"
  | "REVIEW_RECEIVED"
  | "IDENTITY_VERIFIED"
  | "IDENTITY_REJECTED"
  | "LISTING_REMOVED"
  | "ACCOUNT_SUSPENDED"
  | "REPORT_RESOLVED";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/notifications${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? "Something went wrong.", body.code, body.field);
  }
  return body as T;
}

export function getNotifications(opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.unreadOnly) params.set("unread", "true");
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return request<{ notifications: Notification[]; unread: number }>(qs ? `?${qs}` : "");
}

/** Just the count, for the nav bell. */
export function getUnreadCount() {
  return request<{ unread: number }>("/count");
}

export function markNotificationRead(id: string) {
  return request<{ unread: number }>(`/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return request<{ marked: number; unread: number }>("/read-all", { method: "POST" });
}

export function deleteNotification(id: string) {
  return request<void>(`/${id}`, { method: "DELETE" });
}

/**
 * A small glyph per type, so a list of ten is scannable.
 *
 * Paired with the title text, never standing alone — an icon by itself is not
 * something a screen reader can convey.
 */
export const NOTIFICATION_ICON: Record<NotificationType, string> = {
  SALE_MADE: "£",
  ORDER_SHIPPED: "→",
  ORDER_DELIVERED: "✓",
  ORDER_UNFULFILLABLE: "!",
  REVIEW_RECEIVED: "★",
  IDENTITY_VERIFIED: "✓",
  IDENTITY_REJECTED: "!",
  LISTING_REMOVED: "!",
  ACCOUNT_SUSPENDED: "!",
  REPORT_RESOLVED: "·",
};

/** Types that carry bad news, so they can be toned differently. */
export const IS_BAD_NEWS: Record<NotificationType, boolean> = {
  SALE_MADE: false,
  ORDER_SHIPPED: false,
  ORDER_DELIVERED: false,
  ORDER_UNFULFILLABLE: true,
  REVIEW_RECEIVED: false,
  IDENTITY_VERIFIED: false,
  IDENTITY_REJECTED: true,
  LISTING_REMOVED: true,
  ACCOUNT_SUSPENDED: true,
  REPORT_RESOLVED: false,
};

/** "3 minutes ago" — short, because these sit in a narrow dropdown. */
export function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

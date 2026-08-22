"use client";

import Link from "next/link";
import type { User } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { useDismissable } from "@/lib/useDismissable";

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function UserMenu({ user }: { user: User }) {
  const { logout } = useAuth();
  const { open, setOpen, ref } = useDismissable<HTMLDivElement>();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-dim text-sm font-semibold text-paper transition hover:brightness-90"
      >
        {getInitials(user.name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-line bg-paper-card p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-dim">{user.email}</p>
          </div>

          <div className="my-1 h-px bg-line" />

          <Link
            href="/account"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-ink transition hover:bg-blush"
          >
            Your account
          </Link>
          <Link
            href="/cart"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-ink transition hover:bg-blush"
          >
            My cart
          </Link>
          <Link
            href="/wishlist"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-ink transition hover:bg-blush"
          >
            Wishlist
          </Link>
          <Link
            href={user.isSeller ? "/seller" : "/account"}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-ink transition hover:bg-blush"
          >
            {user.isSeller ? "Seller dashboard" : "Start selling"}
          </Link>

          <div className="my-1 h-px bg-line" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-ink transition hover:bg-blush"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

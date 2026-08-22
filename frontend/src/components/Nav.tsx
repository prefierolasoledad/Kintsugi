"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";
import NotificationBell from "@/components/NotificationBell";
import SearchWithFilters from "@/components/SearchWithFilters";
import UserMenu from "@/components/UserMenu";
import { useAuth } from "@/lib/AuthContext";

const LINKS = [
  { key: "shop", href: "#categories", label: "Shop" },
  { key: "about", href: "#philosophy", label: "About Us" },
  { key: "sell", href: "#sell", label: "Sell" },
  { key: "contact", href: "/help/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const { user, loading, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-4">
        <a href="#top" className="flex shrink-0 items-center gap-2.5">
          <Logo size={30} />
          <span className="font-serif text-xl font-medium tracking-tight text-ink">
            金継ぎ <span className="text-gradient-gold">Kintsugi</span>
          </span>
        </a>

        {user && (
          <div className="hidden flex-1 justify-center md:flex">
            <div className="w-full max-w-xl">
              <SearchWithFilters />
            </div>
          </div>
        )}

        {!user && (
          <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-ink-dim transition hover:text-gold-dim"
              >
                {link.label}
              </a>
            ))}
          </nav>
        )}

        <div className="hidden shrink-0 items-center gap-4 md:flex">
          {loading ? null : user ? (
            <>
              <UserMenu user={user} />
              <NotificationBell />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-ink-dim transition hover:text-gold-dim"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-gold-dim px-4 py-2 text-sm font-semibold text-paper shadow-sm transition hover:brightness-90"
              >
                Start selling
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-ink md:hidden"
          aria-label="Toggle navigation"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-4 border-t border-line px-6 py-4 md:hidden">
          {user && <SearchWithFilters />}

          {!user &&
            LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-sm text-ink-dim hover:text-gold-dim"
              >
                {link.label}
              </a>
            ))}

          <div className="mt-2 flex flex-col gap-4 border-t border-line pt-4">
            {loading ? null : user ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="text-sm text-ink-dim hover:text-gold-dim"
                >
                  Hi, {user.name.split(" ")[0]}
                </Link>
                <Link
                  href="/cart"
                  onClick={() => setOpen(false)}
                  className="text-sm text-ink-dim hover:text-gold-dim"
                >
                  My cart
                </Link>
                <Link
                  href="/wishlist"
                  onClick={() => setOpen(false)}
                  className="text-sm text-ink-dim hover:text-gold-dim"
                >
                  Wishlist
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    logout();
                  }}
                  className="text-left text-sm font-medium text-ink-dim hover:text-gold-dim"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-ink-dim hover:text-gold-dim"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-gold-dim hover:text-gold"
                >
                  Start selling
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}

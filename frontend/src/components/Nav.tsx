"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";
import { useAuth } from "@/lib/AuthContext";

const LINKS = [
  { href: "#categories", label: "Shop" },
  { href: "#philosophy", label: "Philosophy" },
  { href: "#sell", label: "Sell" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const { user, loading, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <a href="#top" className="flex shrink-0 items-center gap-2.5">
          <Logo size={30} />
          <span className="font-serif text-xl font-medium tracking-tight text-ink">
            金継ぎ <span className="text-gradient-gold">Kintsugi</span>
          </span>
        </a>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="hidden flex-1 items-center md:flex"
        >
          <div className="relative w-full max-w-md">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Search for furniture, jackets, records…"
              className="w-full rounded-full border border-line bg-paper-card py-2.5 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-dim/70 focus:border-gold"
            />
          </div>
        </form>

        <nav className="hidden shrink-0 items-center gap-6 lg:flex">
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

        <div className="hidden shrink-0 items-center gap-4 md:flex">
          {loading ? null : user ? (
            <>
              <span className="text-sm text-ink-dim">Hi, {user.name.split(" ")[0]}</span>
              <button
                type="button"
                onClick={() => logout()}
                className="text-sm font-medium text-ink-dim transition hover:text-gold-dim"
              >
                Log out
              </button>
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
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Search Kintsugi"
              className="w-full rounded-full border border-line bg-paper-card py-2.5 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-dim/70 focus:border-gold"
            />
          </div>

          {LINKS.map((link) => (
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
                <span className="text-sm text-ink-dim">Hi, {user.name.split(" ")[0]}</span>
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

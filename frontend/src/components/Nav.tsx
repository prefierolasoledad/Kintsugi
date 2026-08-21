"use client";

import { useState } from "react";
import Logo from "@/components/Logo";

const LINKS = [
  { href: "#categories", label: "Shop" },
  { href: "#philosophy", label: "Philosophy" },
  { href: "#sell", label: "Sell" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="font-serif text-xl font-medium tracking-tight text-ink">
            金継ぎ <span className="text-gradient-gold">Kintsugi</span>
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex">
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

        <a
          href="#sell"
          className="hidden rounded-full border border-gold/50 px-4 py-2 text-sm font-medium text-gold-dim transition hover:border-gold hover:bg-gold/10 md:inline-block"
        >
          Start selling
        </a>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-ink md:hidden"
          aria-label="Toggle navigation"
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-4 border-t border-line px-6 py-4 md:hidden">
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
        </nav>
      )}
    </header>
  );
}

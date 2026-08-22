"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";

const COLUMNS = [
  {
    heading: "Shop",
    links: [
      { label: "Furniture & Home", href: "/shop/furniture-home" },
      { label: "Clothing & Accessories", href: "/shop/clothing-accessories" },
      { label: "Music, Film & Books", href: "/shop/music-film-books" },
      { label: "Décor & Curiosities", href: "/shop/decor-curiosities" },
      { label: "Bikes & Outdoors", href: "/shop/bikes-outdoors" },
    ],
  },
  {
    heading: "Sell",
    links: [
      { label: "How it works", href: "/sell/how-it-works" },
      { label: "Seller fees", href: "/sell/seller-fees" },
      { label: "Shipping labels", href: "/sell/shipping-labels" },
      { label: "Payouts", href: "/sell/payouts" },
    ],
  },
  {
    heading: "Help",
    links: [
      { label: "Returns & refunds", href: "/help/returns-refunds" },
      { label: "Shipping", href: "/help/shipping" },
      { label: "Trust & safety", href: "/help/trust-safety" },
      { label: "Contact us", href: "/help/contact" },
    ],
  },
];

export default function Footer() {
  const [subscribed, setSubscribed] = useState(false);

  return (
    <footer className="border-t border-line bg-paper-card px-6 py-14">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <Logo size={26} />
              <span className="font-serif text-lg font-medium text-ink">
                金継ぎ Kintsugi
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-dim">
              Repaired, not hidden. A marketplace for secondhand furniture, clothing,
              and objects worth a second life.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-sm font-semibold text-ink">{col.heading}</h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-dim hover:text-gold-dim"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-sm font-semibold text-ink">Stay in the loop</h3>
            <p className="mt-3 text-sm text-ink-dim">
              New listings and the odd good find, once a week.
            </p>
            {subscribed ? (
              <p className="mt-3 text-sm font-medium text-gold-dim">You&apos;re on the list.</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubscribed(true);
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-full border border-line bg-paper px-3.5 py-2 text-sm text-ink outline-none placeholder:text-ink-dim/70 focus:border-gold"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-full bg-gold-dim px-4 py-2 text-sm font-semibold text-paper transition hover:brightness-90"
                >
                  Join
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 text-xs text-ink-dim sm:flex-row">
          <span>© {new Date().getFullYear()} Kintsugi</span>
          <span>Marketplace imagery via Unsplash.</span>
        </div>
      </div>
    </footer>
  );
}

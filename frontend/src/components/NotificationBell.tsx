"use client";

import { useDismissable } from "@/lib/useDismissable";

export default function NotificationBell() {
  const { open, setOpen, ref } = useDismissable<HTMLDivElement>();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Notifications"
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-dim transition hover:bg-blush hover:text-gold-dim"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-line bg-paper-card p-4 shadow-lg"
        >
          <p className="text-sm font-medium text-ink">Notifications</p>
          <p className="mt-2 text-sm text-ink-dim">
            Nothing yet — this is where order updates and offers will show up.
          </p>
        </div>
      )}
    </div>
  );
}

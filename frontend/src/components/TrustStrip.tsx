const POINTS = [
  {
    label: "Hand-checked listings",
    icon: (
      <path d="M9 12.5l2 2 4-4.5M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    ),
  },
  {
    label: "Flaws always disclosed",
    icon: <path d="M12 8v5m0 3.5h.01M12 3l9 16H3l9-16z" />,
  },
  {
    label: "Free 14-day returns",
    icon: <path d="M4 4v5h5M4 9a8 8 0 1 0 2.3-5.6L4 6" />,
  },
];

export default function TrustStrip() {
  return (
    <section className="border-b border-line bg-sand px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-6 sm:flex-row sm:gap-12">
        {POINTS.map((point) => (
          <div key={point.label} className="flex items-center gap-2.5">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 text-gold-dim"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {point.icon}
            </svg>
            <span className="text-sm font-medium text-ink-dim">{point.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

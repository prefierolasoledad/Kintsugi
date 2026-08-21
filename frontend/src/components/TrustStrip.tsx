const POINTS = [
  "Every listing hand-checked before it ships",
  "Flaws disclosed in the listing, never hidden",
  "Free 14-day returns if it isn't as described",
];

export default function TrustStrip() {
  return (
    <section className="border-b border-line px-6 py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-3 text-sm text-ink-dim sm:flex-row sm:gap-8">
        {POINTS.map((point) => (
          <span key={point} className="flex items-center gap-2">
            <span className="text-gold-dim">◆</span>
            {point}
          </span>
        ))}
      </div>
    </section>
  );
}

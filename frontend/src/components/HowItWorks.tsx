import Link from "next/link";

const STEPS = [
  {
    title: "List it",
    description:
      "A few photos and an honest description of its condition. Flaws included — they're part of the listing, not a reason to hide it.",
  },
  {
    title: "It finds its person",
    description:
      "Your item shows up in the right category for buyers who are specifically looking for something like it, not scrolling past it.",
  },
  {
    title: "Get paid",
    description:
      "Once the buyer confirms it arrived as described, payment is released to you. No haggling in person, no chasing a no-show.",
  },
];

export default function HowItWorks() {
  return (
    <section id="sell" className="bg-butter px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Sell in <span className="text-gradient-gold">three steps.</span>
          </h2>
          <p className="mt-4 text-ink-dim">
            Have something worth a second life? Here&apos;s the whole process.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="rounded-3xl border border-line bg-paper-card p-6 shadow-sm transition hover:shadow-md"
            >
              <span className="font-mono text-sm text-gold-dim">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-dim">
                {step.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <Link
            href="/signup"
            className="seam-glow rounded-full bg-gold-dim px-6 py-3 text-sm font-semibold text-paper transition hover:brightness-90"
          >
            Start selling
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Hero() {
  return (
    <section id="top" className="px-6 pt-20 pb-16">
      <div className="mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 px-4 py-1 text-xs font-medium tracking-wide text-gold-dim uppercase">
          Secondhand, chosen with care
        </span>

        <h1 className="mt-6 font-serif text-4xl font-medium tracking-tight text-ink sm:text-6xl">
          Every piece here
          <br />
          <span className="text-gradient-gold">has a past. That&apos;s the point.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-dim">
          Kintsugi is a marketplace for pre-loved furniture, clothing, and objects —
          chosen for character, not condition. Buy something with a story, or list the
          one taking up space in your closet.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#categories"
            className="seam-glow rounded-full bg-gold px-6 py-3 text-sm font-semibold text-ink transition hover:bg-gold-bright"
          >
            Shop the collection
          </a>
          <a
            href="#sell"
            className="rounded-full border border-line px-6 py-3 text-sm font-medium text-ink transition hover:border-gold/50 hover:text-gold-dim"
          >
            Start selling
          </a>
        </div>
      </div>
    </section>
  );
}

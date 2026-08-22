import Image from "next/image";
import Link from "next/link";
import { IMAGES } from "@/lib/images";

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-blush">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-12 px-6 py-16 lg:flex-row lg:justify-between lg:gap-8 lg:py-20">
        <div className="text-center lg:w-1/2 lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-paper/60 px-4 py-1 text-xs font-medium tracking-wide text-gold-dim uppercase">
            Secondhand, chosen with care
          </span>

          <h1 className="mt-6 font-serif text-4xl font-medium tracking-tight text-ink sm:text-6xl">
            Every piece here
            <br />
            <span className="text-gradient-gold">has a past. That&apos;s the point.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-dim lg:mx-0">
            Kintsugi is a marketplace for pre-loved furniture, clothing, and objects —
            chosen for character, not condition. Buy something with a story, or list the
            one taking up space in your closet.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
            <a
              href="#categories"
              className="seam-glow rounded-full bg-gold-dim px-6 py-3 text-sm font-semibold text-paper transition hover:brightness-90"
            >
              Shop the collection
            </a>
            <Link
              href="/signup"
              className="rounded-full border border-line bg-paper/70 px-6 py-3 text-sm font-medium text-ink transition hover:border-gold/50 hover:text-gold-dim"
            >
              Start selling
            </Link>
          </div>
        </div>

        <div className="relative h-[420px] w-full max-w-md sm:h-[480px] lg:w-1/2">
          <div className="absolute -top-10 -right-6 h-56 w-56 rounded-full bg-sage/50 blur-3xl" />
          <div className="absolute bottom-0 -left-10 h-64 w-64 rounded-full bg-gold/25 blur-3xl" />
          <div className="absolute top-1/3 right-1/4 h-40 w-40 rounded-full bg-lavender-tint blur-2xl" />

          <div className="absolute top-2 left-0 w-40 -rotate-6 overflow-hidden rounded-3xl border-4 border-paper shadow-xl sm:w-48">
            <Image
              src={IMAGES.midCenturyChairs}
              alt="Mid-century armchairs"
              width={220}
              height={275}
              className="aspect-4/5 h-auto w-full object-cover"
            />
          </div>

          <div className="absolute top-0 right-0 w-32 rotate-6 overflow-hidden rounded-3xl border-4 border-paper shadow-xl sm:w-40">
            <Image
              src={IMAGES.leatherJacket}
              alt="Brown leather jacket"
              width={180}
              height={180}
              className="aspect-square h-auto w-full object-cover"
            />
          </div>

          <div className="absolute bottom-6 left-14 w-44 rotate-3 overflow-hidden rounded-3xl border-4 border-paper shadow-2xl sm:w-56">
            <Image
              src={IMAGES.kintsugiPlate}
              alt="Ceramic plate repaired with gold seams"
              width={240}
              height={300}
              className="aspect-4/5 h-auto w-full object-cover"
            />
          </div>

          <div className="absolute right-2 bottom-0 w-28 -rotate-3 overflow-hidden rounded-3xl border-4 border-paper shadow-xl sm:w-36">
            <Image
              src={IMAGES.vintageCamera}
              alt="Vintage Kodak camera"
              width={160}
              height={160}
              className="aspect-square h-auto w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

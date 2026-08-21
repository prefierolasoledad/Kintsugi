import Image from "next/image";
import { IMAGES } from "@/lib/images";

export default function Philosophy() {
  return (
    <section id="philosophy" className="px-6 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <div className="relative h-80 overflow-hidden rounded-2xl border border-line md:h-96">
          <Image
            src={IMAGES.kintsugiPlate}
            alt="A ceramic plate repaired with gold seams, in the Japanese kintsugi style"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>

        <div>
          <h2 className="font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            The name means <span className="text-gradient-gold">something.</span>
          </h2>
          <p className="mt-4 text-ink-dim">
            Kintsugi (金継ぎ) is the Japanese art of repairing broken pottery with
            gold — treating the break as part of the object&apos;s history instead
            of something to hide.
          </p>
          <p className="mt-4 text-ink-dim">
            That&apos;s the idea behind the shop. Every secondhand piece here already
            had a story before it reached you — a previous owner, a few years of use,
            maybe a repair of its own. We&apos;re not in the business of pretending
            things are new. We&apos;re in the business of things that lasted.
          </p>
        </div>
      </div>
    </section>
  );
}

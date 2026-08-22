import Image from "next/image";
import Link from "next/link";
import { IMAGES } from "@/lib/images";
import type { User } from "@/lib/api";

export default function PersonalizedHero({ user }: { user: User }) {
  const firstName = user.name.split(" ")[0];

  return (
    <section className="relative h-72 overflow-hidden sm:h-80">
      <Image
        src={IMAGES.browsingClothesRack}
        alt="Shopper browsing a rack of secondhand clothing"
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-linear-to-t from-ink from-15% via-ink/55 via-50% to-ink/10" />

      <div className="relative mx-auto flex h-full max-w-[1400px] flex-col items-start justify-end px-6 pb-10">
        <span className="rounded-full border border-paper/40 bg-ink/30 px-3 py-1 text-xs font-medium tracking-wide text-paper/90 uppercase backdrop-blur-sm">
          Hi, {firstName}
        </span>

        <h1 className="mt-3 font-serif text-3xl font-medium tracking-tight text-paper sm:text-4xl">
          New arrivals since your last visit.
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href="#recommended"
            className="seam-glow rounded-full bg-gold-dim px-5 py-2.5 text-sm font-semibold text-paper transition hover:brightness-90"
          >
            Shop what's new
          </a>
          <Link
            href="/account"
            className="rounded-full border border-paper/40 px-5 py-2.5 text-sm font-medium text-paper transition hover:border-paper/70"
          >
            {user.isSeller ? "Go to your dashboard" : "Start selling"}
          </Link>
        </div>
      </div>
    </section>
  );
}

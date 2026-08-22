import Image from "next/image";
import Link from "next/link";
import { CATEGORIES } from "@/lib/listings";

export default function Categories() {
  return (
    <section id="categories" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Shop by <span className="text-gradient-gold">category.</span>
          </h2>
          <p className="mt-4 text-ink-dim">
            Nothing here was made this year. That&apos;s the appeal.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <Link
              key={category.slug}
              href={`/shop/${category.slug}`}
              className="group relative block h-72 overflow-hidden rounded-3xl border border-line shadow-sm transition hover:shadow-lg"
            >
              <Image
                src={category.coverImage}
                alt={category.title}
                fill
                sizes="(min-width: 640px) 50vw, 100vw"
                className="object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-linear-to-t from-ink via-ink/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <h3 className="text-lg font-semibold text-paper">
                  {category.title}
                </h3>
                <p className="mt-1 text-sm text-paper/80">
                  {category.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

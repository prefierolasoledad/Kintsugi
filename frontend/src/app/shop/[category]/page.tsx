import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import ListingCard from "@/components/ListingCard";
import Nav from "@/components/Nav";
import { CATEGORIES, getCategory } from "@/lib/listings";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: slug } = await params;
  const category = getCategory(slug);

  if (!category) {
    notFound();
  }

  return (
    <>
      <Nav />
      <main className="flex-1">
        <section className="relative h-56 overflow-hidden sm:h-72">
          <Image
            src={category.coverImage}
            alt={category.title}
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-t from-ink from-10% via-ink/50 via-40% to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 py-8">
            <div className="mx-auto max-w-6xl">
              <h1 className="font-serif text-3xl font-medium text-paper sm:text-4xl">
                {category.title}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-paper/80">
                {category.description}
              </p>
            </div>
          </div>
        </section>

        <section className="px-6 py-12">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  href={`/shop/${c.slug}`}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                    c.slug === category.slug
                      ? "border-gold-dim bg-gold-dim text-paper"
                      : "border-line text-ink-dim hover:border-gold/50 hover:text-gold-dim"
                  }`}
                >
                  {c.title}
                </Link>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {category.listings.map((item) => (
                <ListingCard key={item.title} item={item} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

import Link from "next/link";
import ListingCard from "@/components/ListingCard";
import type { CatalogListing } from "@/lib/catalog";

export default function RecentlyListed({ listings }: { listings: CatalogListing[] }) {
  if (listings.length === 0) return null;

  return (
    <section className="px-6 pt-16 pb-20">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-ink">
            Recently listed
          </h2>
          <Link
            href="/search?sort=newest"
            className="text-sm text-ink-dim transition hover:text-gold-dim"
          >
            See all →
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {listings.map((item) => (
            <ListingCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

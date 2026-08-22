import ListingCard from "@/components/ListingCard";
import type { CatalogListing } from "@/lib/catalog";

export default function RecommendedForYou({
  name,
  listings,
}: {
  name: string;
  listings: CatalogListing[];
}) {
  if (listings.length === 0) return null;

  return (
    <section id="recommended" className="px-6 pt-16 pb-4">
      <div className="mx-auto max-w-[1400px]">
        <h2 className="font-serif text-2xl font-medium tracking-tight text-ink">
          Picked for you, {name}
        </h2>
        <p className="mt-1 text-sm text-ink-dim">
          A few things we think are worth a look.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {listings.map((item) => (
            <ListingCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

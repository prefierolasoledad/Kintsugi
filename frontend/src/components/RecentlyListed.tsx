import ListingCard from "@/components/ListingCard";
import { CATEGORIES } from "@/lib/listings";

const FEATURED = [
  CATEGORIES[3].listings[1], // Kodak vintage camera
  CATEGORIES[2].listings[0], // Retro record player
  CATEGORIES[1].listings[0], // Brown leather jacket
  CATEGORIES[0].listings[0], // Mid-century armchair pair
];

export default function RecentlyListed() {
  return (
    <section className="px-6 pt-16 pb-20">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-ink">
            Recently listed
          </h2>
          <a
            href="#categories"
            className="text-sm text-ink-dim transition hover:text-gold-dim"
          >
            See all →
          </a>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {FEATURED.map((item) => (
            <ListingCard key={item.title} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

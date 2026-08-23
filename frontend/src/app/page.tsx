import HomeSections from "@/components/HomeSections";
import { getCategories, getListings, type CatalogListing } from "@/lib/catalog";

/** Keeps a listing from appearing in two shelves in a row. */
function take(pool: CatalogListing[], used: Set<string>, count: number) {
  const picked: CatalogListing[] = [];
  for (const item of pool) {
    if (picked.length === count) break;
    if (used.has(item.id)) continue;
    picked.push(item);
    used.add(item.id);
  }
  return picked;
}

export default async function Home() {
  const [categories, all] = await Promise.all([
    getCategories(),
    getListings({ limit: 48, sort: "newest" }),
  ]);

  const listings = all.listings;
  const used = new Set<string>();

  // Derived rather than flagged: a higher original price means it genuinely is
  // reduced, so nothing here claims a discount that doesn't exist.
  const discounted = take(
    listings.filter((l) => l.originalPriceCents && l.originalPriceCents > l.priceCents),
    used,
    4
  );

  // Actually sorted by rating — and only listings that have reviews, so an
  // unreviewed item never appears under "Best Rated".
  const topRated = take(
    [...listings]
      .filter((l) => l.rating.average !== null)
      .sort((a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0)),
    used,
    4
  );

  const newArrivals = take(listings, used, 4);

  return (
    <HomeSections
      categories={categories}
      discounted={discounted}
      topRated={topRated}
      newArrivals={newArrivals}
      // The closing shelf is the whole catalog, so overlap here is the point.
      everything={listings.slice(0, 8)}
    />
  );
}

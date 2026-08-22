import HomeSections from "@/components/HomeSections";
import { getCategories, getListings } from "@/lib/catalog";

export default async function Home() {
  const [categories, recent, featured] = await Promise.all([
    getCategories(),
    getListings({ limit: 4, sort: "newest" }),
    getListings({ featured: "true", limit: 4 }),
  ]);

  return (
    <HomeSections
      categories={categories}
      recent={recent.listings}
      featured={featured.listings}
    />
  );
}

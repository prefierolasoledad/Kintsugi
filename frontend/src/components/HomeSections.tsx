"use client";

import Categories from "@/components/Categories";
import Footer from "@/components/Footer";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import Nav from "@/components/Nav";
import PersonalizedHero from "@/components/PersonalizedHero";
import Philosophy from "@/components/Philosophy";
import RecentlyListed from "@/components/RecentlyListed";
import RecommendedForYou from "@/components/RecommendedForYou";
import SeamDivider from "@/components/SeamDivider";
import TrustStrip from "@/components/TrustStrip";
import type { CatalogCategory, CatalogListing } from "@/lib/catalog";
import { useAuth } from "@/lib/AuthContext";

/**
 * The catalog is fetched on the server; this component only decides which
 * arrangement a visitor sees, which is the one thing that depends on client
 * auth state.
 */
export default function HomeSections({
  categories,
  recent,
  featured,
}: {
  categories: CatalogCategory[];
  recent: CatalogListing[];
  featured: CatalogListing[];
}) {
  const { user } = useAuth();

  return (
    <>
      <Nav />
      <main className="flex-1">
        {user ? <PersonalizedHero user={user} /> : <Hero />}
        {user && (
          <RecommendedForYou name={user.name.split(" ")[0]} listings={featured} />
        )}
        <RecentlyListed listings={recent} />
        <TrustStrip />
        {!user && (
          <>
            <Categories categories={categories} />
            <SeamDivider />
            <Philosophy />
            <SeamDivider />
            <HowItWorks />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

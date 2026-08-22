"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import { useAuth } from "@/lib/AuthContext";

export default function WishlistPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <>
        <Nav />
        <main className="flex-1 px-6 py-16">
          <div className="mx-auto max-w-5xl text-sm text-ink-dim">Loading…</div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="flex-1 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-baseline justify-between">
            <h1 className="font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
              Wishlist
            </h1>
            <span className="rounded-full border border-gold/30 px-2.5 py-1 text-xs font-medium text-gold-dim">
              Planned
            </span>
          </div>
          <p className="mt-4 max-w-xl text-sm text-ink-dim">
            Saving items for later isn&apos;t built yet — this is where anything you save
            from a listing will show up. For now, browse{" "}
            <a href="/" className="text-gold-dim underline">
              what&apos;s in the shop
            </a>
            .
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}

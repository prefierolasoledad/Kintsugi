"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Footer from "@/components/Footer";
import ListingForm from "@/components/ListingForm";
import Nav from "@/components/Nav";
import { useAuth } from "@/lib/AuthContext";
import { createListing, type ListingInput } from "@/lib/sellerApi";

export default function NewListingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && !user.isSeller) router.push("/seller");
  }, [loading, user, router]);

  async function handleSubmit(input: ListingInput) {
    const { listing } = await createListing(input);
    // Straight to the edit page: photos need a listing to attach to, and a
    // listing can't be published without one.
    router.push(`/seller/listings/${listing.id}?created=1`);
  }

  if (loading || !user) {
    return (
      <>
        <Nav />
        <main className="flex-1 px-6 py-16">
          <div className="mx-auto max-w-2xl text-sm text-ink-dim">Loading…</div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Nav />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/seller"
            className="text-sm text-ink-dim transition hover:text-gold-dim"
          >
            ← Your listings
          </Link>

          <h1 className="mt-4 font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            List an item
          </h1>
          <p className="mt-3 text-sm text-ink-dim">
            Saved as a draft first. You&apos;ll add photos on the next step, then publish
            when it&apos;s ready.
          </p>

          <ListingForm submitLabel="Save draft" onSubmit={handleSubmit} />
        </div>
      </main>
      <Footer />
    </>
  );
}

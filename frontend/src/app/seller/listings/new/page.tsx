"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Footer from "@/components/Footer";
import ListingForm from "@/components/ListingForm";
import Nav from "@/components/Nav";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import {
  createListing,
  publishListing,
  uploadListingImage,
  type ListingInput,
} from "@/lib/sellerApi";

export default function NewListingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && !user.isSeller) router.push("/seller");
  }, [loading, user, router]);

  async function handleSubmit(input: ListingInput, photos: File[]) {
    // The listing has to exist before images can attach to it, so this is one
    // action from the seller's point of view and three calls underneath.
    const { listing } = await createListing(input);

    let uploaded = 0;
    const failed: string[] = [];

    for (const [index, file] of photos.entries()) {
      setProgress(`Uploading photo ${index + 1} of ${photos.length}…`);
      try {
        await uploadListingImage(listing.id, file);
        uploaded++;
      } catch {
        failed.push(file.name);
      }
    }

    // A photo is the only thing publishing requires, so if one landed we can
    // take the seller straight to a live listing.
    let published = false;
    if (uploaded > 0) {
      setProgress("Publishing…");
      try {
        await publishListing(listing.id);
        published = true;
      } catch {
        // Left as a draft; the editor explains what's needed.
      }
    }

    const params = new URLSearchParams({ created: "1" });
    if (published) params.set("published", "1");
    if (failed.length) params.set("failed", String(failed.length));

    router.push(`/seller/listings/${listing.id}?${params}`);
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
            Add photos and the details, and it goes live as soon as you save. Say
            what&apos;s wrong with it as well as what&apos;s right — buyers here expect
            that.
          </p>

          <ListingForm
            submitLabel="Publish listing"
            collectPhotos
            progress={progress}
            onSubmit={handleSubmit}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}

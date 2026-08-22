"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import { useAuth } from "@/lib/AuthContext";

function PlannedBadge() {
  return (
    <span className="rounded-full border border-gold/30 px-2.5 py-1 text-xs font-medium text-gold-dim">
      Planned
    </span>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const { user, loading, becomeSeller } = useAuth();
  const [becomingSeller, setBecomingSeller] = useState(false);

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

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  async function handleBecomeSeller() {
    setBecomingSeller(true);
    try {
      await becomeSeller();
    } finally {
      setBecomingSeller(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="flex-1 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h1 className="font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Welcome back, {user.name.split(" ")[0]}.
          </h1>
          <p className="mt-2 text-sm text-ink-dim">Member since {memberSince}.</p>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-line bg-paper-card p-6 md:col-span-1">
              <h2 className="text-sm font-semibold text-ink">Account</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-ink-dim">Name</dt>
                  <dd className="text-ink">{user.name}</dd>
                </div>
                <div>
                  <dt className="text-ink-dim">Email</dt>
                  <dd className="text-ink">{user.email}</dd>
                </div>
                <div>
                  <dt className="text-ink-dim">Status</dt>
                  <dd className="flex items-center gap-1.5 text-sage-dim">
                    <span className="h-1.5 w-1.5 rounded-full bg-sage-dim" />
                    Verified
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-line bg-paper-card p-6 md:col-span-2">
              <h2 className="text-sm font-semibold text-ink">Selling</h2>
              {user.isSeller ? (
                <>
                  <p className="mt-3 text-sm text-ink-dim">
                    You&apos;re set up to sell on Kintsugi.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href="/sell/how-it-works"
                      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:border-gold/50 hover:text-gold-dim"
                    >
                      How selling works
                    </Link>
                    <Link
                      href="/sell/payouts"
                      className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:border-gold/50 hover:text-gold-dim"
                    >
                      Payouts
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm text-ink-dim">
                    Have something worth a second life? Turn on selling to list your first
                    item.
                  </p>
                  <button
                    type="button"
                    onClick={handleBecomeSeller}
                    disabled={becomingSeller}
                    className="seam-glow mt-4 rounded-full bg-gold-dim px-5 py-2.5 text-sm font-semibold text-paper transition hover:brightness-90 disabled:opacity-60"
                  >
                    {becomingSeller ? "Turning on…" : "Start selling"}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-line bg-paper-card p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">Orders</h2>
                <PlannedBadge />
              </div>
              <p className="mt-3 text-sm text-ink-dim">
                Order history isn&apos;t built yet — this is where your purchases will show
                up once checkout exists.
              </p>
            </div>

            <div className="rounded-3xl border border-line bg-paper-card p-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-ink">My listings</h2>
                <PlannedBadge />
              </div>
              <p className="mt-3 text-sm text-ink-dim">
                Listing your own items isn&apos;t built yet — for now, browse what&apos;s
                already in the shop.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import OrderLines from "@/components/OrderLines";
import OrderStatusPill from "@/components/OrderStatusPill";
import ShipToCard from "@/components/ShipToCard";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { formatPrice } from "@/lib/catalog";
import { getOrder, isOpen, type Order } from "@/lib/ordersApi";

/** A single order: receipt when paid, status and next step when not. */
export default function OrderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const { user, loading } = useAuth();

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  const load = useCallback(async () => {
    try {
      const { order } = await getOrder(orderId);
      setOrder(order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load that order.");
    }
  }, [orderId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading || !user) {
    return <Shell><p className="text-sm text-ink-dim">Loading…</p></Shell>;
  }

  if (error) {
    return (
      <Shell>
        <h1 className="font-serif text-2xl font-semibold text-ink">
          We couldn&apos;t find that order
        </h1>
        <p className="mt-3 text-sm text-ink-dim">{error}</p>
        <Link
          href="/account/orders"
          className="mt-6 inline-block rounded bg-gold-dim px-5 py-2.5 text-sm font-medium text-paper transition hover:brightness-95"
        >
          Your orders
        </Link>
      </Shell>
    );
  }

  if (!order) {
    return <Shell><p className="text-sm text-ink-dim">Loading…</p></Shell>;
  }

  const paid = order.status === "PAID";

  return (
    <Shell>
      <Link
        href="/account/orders"
        className="text-sm text-ink-dim transition hover:text-gold-dim"
      >
        ← Your orders
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {paid ? "Thank you" : "Your order"}
        </h1>
        <OrderStatusPill status={order.status} />
      </div>

      <p className="mt-3 text-sm text-ink-dim">
        Order <span className="font-medium text-ink">{order.reference}</span>
        {" · "}
        {new Date(order.createdAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </p>

      {paid && order.testMode && (
        <p className="mt-6 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-ink">
          <span className="font-medium">Sandbox order.</span> No money changed
          hands and nothing will be shipped — this is a test payment.
        </p>
      )}

      {order.failureReason && !paid && (
        <p className="mt-6 rounded-xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm text-clay">
          {order.failureReason}
        </p>
      )}

      {paid && (
        <div className="mt-8">
          <ShipToCard shipTo={order.shipTo} title="Delivered to" />
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-line bg-paper-card p-6">
        <OrderLines order={order} onChanged={load} />

        <div className="mt-6 flex items-baseline justify-between border-t border-line pt-5">
          <span className="text-sm text-ink-dim">
            {paid ? "Paid" : "Total"}
          </span>
          <span className="text-xl font-semibold text-gold-dim">
            {formatPrice(order.subtotalCents, order.currency)}
          </span>
        </div>

        {order.paidAt && (
          <p className="mt-2 text-xs text-ink-dim">
            Paid {new Date(order.paidAt).toLocaleString()}
            {order.paymentProvider && ` · via ${order.paymentProvider}`}
          </p>
        )}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {isOpen(order) && (
          <Link
            href={`/checkout/${order.id}`}
            className="rounded bg-gold-dim px-6 py-3 text-sm font-medium text-paper transition hover:brightness-95"
          >
            {order.status === "PROCESSING" ? "Check payment" : "Finish paying"}
          </Link>
        )}
        <Link
          href="/search"
          className="rounded border border-line px-6 py-3 text-sm font-medium text-ink transition hover:border-gold/40"
        >
          Keep browsing
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <Footer />
    </>
  );
}

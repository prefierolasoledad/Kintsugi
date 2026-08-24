import Image from "next/image";
import Link from "next/link";
import { formatPrice } from "@/lib/catalog";
import type { Order } from "@/lib/ordersApi";

/**
 * The lines of an order, shared by the payment page and the receipt.
 *
 * Everything shown here comes from the order's own snapshot rather than the
 * live listing, so a seller renaming or repricing an item afterwards cannot
 * rewrite what someone sees they bought.
 */
export default function OrderLines({ order }: { order: Order }) {
  return (
    <ul className="grid gap-4">
      {order.items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-4">
          <ItemImage item={item} />

          <div className="min-w-40 flex-1">
            {item.slug ? (
              <Link
                href={`/listing/${item.slug}`}
                className="text-sm font-medium text-ink transition hover:text-gold-dim"
              >
                {item.title}
              </Link>
            ) : (
              // The listing was hard-deleted. The order still has to name it.
              <span className="text-sm font-medium text-ink">{item.title}</span>
            )}
            <p className="mt-1 text-xs text-ink-dim">from {item.sellerName}</p>
          </div>

          <p className="text-sm text-ink-dim">
            {formatPrice(item.unitPriceCents, order.currency)}
            {item.quantity > 1 && ` × ${item.quantity}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ItemImage({ item }: { item: Order["items"][number] }) {
  const frame =
    "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-line";

  if (!item.image) {
    return (
      <span className={`${frame} flex items-center justify-center bg-blush`}>
        <span className="text-[10px] text-ink-dim">No photo</span>
      </span>
    );
  }

  const img = (
    <Image src={item.image} alt={item.title} fill sizes="64px" className="object-cover" />
  );

  return item.slug ? (
    <Link href={`/listing/${item.slug}`} className={frame}>
      {img}
    </Link>
  ) : (
    <span className={frame}>{img}</span>
  );
}

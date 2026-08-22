import Image from "next/image";
import Link from "next/link";
import StarRating from "@/components/StarRating";
import { type CatalogListing, discountPercent, formatPrice } from "@/lib/catalog";

export default function ListingCard({ item }: { item: CatalogListing }) {
  const discount = discountPercent(item);
  const cover = item.images[0];

  return (
    <Link
      href={`/listing/${item.slug}`}
      className="group block overflow-hidden rounded-3xl border border-line bg-paper-card shadow-sm transition hover:shadow-lg"
    >
      <div className="relative aspect-square overflow-hidden">
        {cover ? (
          <Image
            src={cover.url}
            alt={cover.alt ?? item.title}
            fill
            sizes="(min-width: 640px) 25vw, 50vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-blush text-xs text-ink-dim">
            No photo yet
          </div>
        )}
        {item.conditionNote && (
          <span className="absolute top-2 left-2 rounded-full bg-paper/95 px-2 py-1 text-[11px] font-medium text-ink shadow-sm">
            {item.conditionNote}
          </span>
        )}
        {discount && (
          <span className="absolute top-2 right-2 rounded-full bg-gold-dim px-2 py-1 text-[11px] font-semibold text-paper shadow-sm">
            -{discount}%
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded-full bg-gold-dim/90 px-2 py-1 text-[10px] font-medium text-paper">
          {item.quantity === 1 ? "Only 1 available" : `${item.quantity} available`}
        </span>
      </div>
      <div className="p-4">
        <h3 className="text-sm font-medium text-ink">{item.title}</h3>
        <div className="mt-1.5">
          {item.rating.average === null ? (
            <span className="text-xs text-ink-dim/80">No reviews yet</span>
          ) : (
            <StarRating rating={item.rating.average} count={item.rating.count} />
          )}
        </div>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gold-dim">
            {formatPrice(item.priceCents, item.currency)}
          </span>
          {item.originalPriceCents && (
            <span className="text-xs text-ink-dim/70 line-through">
              {formatPrice(item.originalPriceCents, item.currency)}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}

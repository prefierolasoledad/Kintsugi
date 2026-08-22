import Image from "next/image";
import StarRating from "@/components/StarRating";
import type { Listing } from "@/lib/listings";

export default function ListingCard({ item }: { item: Listing }) {
  const discount = item.originalPrice
    ? Math.round((1 - item.price / item.originalPrice) * 100)
    : null;

  return (
    <a
      href="#"
      className="group block overflow-hidden rounded-3xl border border-line bg-paper-card shadow-sm transition hover:shadow-lg"
    >
      <div className="relative aspect-square overflow-hidden">
        <Image
          src={item.image}
          alt={item.title}
          fill
          sizes="(min-width: 640px) 25vw, 50vw"
          className="object-cover transition duration-500 group-hover:scale-105"
        />
        <span className="absolute top-2 left-2 rounded-full bg-paper/95 px-2 py-1 text-[11px] font-medium text-ink shadow-sm">
          {item.condition}
        </span>
        {discount && (
          <span className="absolute top-2 right-2 rounded-full bg-gold-dim px-2 py-1 text-[11px] font-semibold text-paper shadow-sm">
            -{discount}%
          </span>
        )}
        <span className="absolute bottom-2 left-2 rounded-full bg-gold-dim/90 px-2 py-1 text-[10px] font-medium text-paper">
          Only 1 available
        </span>
      </div>
      <div className="p-4">
        <h3 className="text-sm font-medium text-ink">{item.title}</h3>
        <div className="mt-1.5">
          <StarRating rating={item.rating} count={item.reviews} />
        </div>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gold-dim">${item.price}</span>
          {item.originalPrice && (
            <span className="text-xs text-ink-dim/70 line-through">
              ${item.originalPrice}
            </span>
          )}
        </p>
      </div>
    </a>
  );
}

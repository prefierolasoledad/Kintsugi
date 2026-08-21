import Image from "next/image";
import { IMAGES } from "@/lib/images";

const LISTINGS = [
  {
    title: "Kodak vintage camera",
    condition: "Well-loved",
    price: "$68",
    image: IMAGES.vintageCamera,
  },
  {
    title: "Retro record player",
    condition: "Fully working",
    price: "$145",
    image: IMAGES.recordPlayer,
  },
  {
    title: "Brown leather jacket",
    condition: "Like new",
    price: "$120",
    image: IMAGES.leatherJacket,
  },
  {
    title: "Mid-century armchair pair",
    condition: "Minor wear",
    price: "$310",
    image: IMAGES.midCenturyChairs,
  },
];

export default function RecentlyListed() {
  return (
    <section className="px-6 pb-20">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl font-medium tracking-tight text-ink">
            Recently listed
          </h2>
          <a
            href="#categories"
            className="text-sm text-ink-dim transition hover:text-gold-dim"
          >
            See all →
          </a>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {LISTINGS.map((item) => (
            <a
              key={item.title}
              href="#"
              className="group block overflow-hidden rounded-2xl border border-line bg-paper-card"
            >
              <div className="relative aspect-square overflow-hidden">
                <Image
                  src={item.image}
                  alt={item.title}
                  fill
                  sizes="(min-width: 640px) 25vw, 50vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-4">
                <h3 className="text-sm font-medium text-ink">{item.title}</h3>
                <p className="mt-1 text-xs text-ink-dim">{item.condition}</p>
                <p className="mt-2 text-sm font-semibold text-gold-dim">
                  {item.price}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

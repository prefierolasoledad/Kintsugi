import { IMAGES } from "@/lib/images";

export type Listing = {
  title: string;
  condition: string;
  price: number;
  originalPrice: number | null;
  rating: number;
  reviews: number;
  image: string;
};

export type Category = {
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  listings: Listing[];
};

export const CATEGORIES: Category[] = [
  {
    slug: "furniture-home",
    title: "Furniture & Home",
    description: "Solid wood, well-worn, built before things were made to be replaced.",
    coverImage: IMAGES.antiqueFurniture,
    listings: [
      {
        title: "Mid-century armchair pair",
        condition: "Minor wear",
        price: 310,
        originalPrice: null,
        rating: 4.7,
        reviews: 11,
        image: IMAGES.midCenturyChairs,
      },
      {
        title: "Antique glass display cabinet",
        condition: "Well-loved",
        price: 240,
        originalPrice: 280,
        rating: 4.5,
        reviews: 8,
        image: IMAGES.antiqueFurniture,
      },
    ],
  },
  {
    slug: "clothing-accessories",
    title: "Clothing & Accessories",
    description: "Vintage and pre-loved pieces, picked for cut and quality.",
    coverImage: IMAGES.clothingRack,
    listings: [
      {
        title: "Brown leather jacket",
        condition: "Like new",
        price: 120,
        originalPrice: 150,
        rating: 4.9,
        reviews: 52,
        image: IMAGES.leatherJacket,
      },
      {
        title: "Assorted vintage outerwear rack",
        condition: "Varies by piece",
        price: 45,
        originalPrice: null,
        rating: 4.4,
        reviews: 27,
        image: IMAGES.clothingRack,
      },
    ],
  },
  {
    slug: "music-film-books",
    title: "Music, Film & Books",
    description: "Vinyl, film, and paperbacks that already found one good home.",
    coverImage: IMAGES.vinylRecords,
    listings: [
      {
        title: "Retro record player",
        condition: "Fully working",
        price: 145,
        originalPrice: null,
        rating: 4.6,
        reviews: 19,
        image: IMAGES.recordPlayer,
      },
      {
        title: "Crate of vinyl records",
        condition: "Well-loved",
        price: 60,
        originalPrice: 75,
        rating: 4.7,
        reviews: 15,
        image: IMAGES.vinylRecords,
      },
    ],
  },
  {
    slug: "decor-curiosities",
    title: "Décor & Curiosities",
    description: "Small objects with more history than a price tag can explain.",
    coverImage: IMAGES.vintageTrinkets,
    listings: [
      {
        title: "Kintsugi-repaired ceramic plate",
        condition: "Repaired, displayed",
        price: 95,
        originalPrice: null,
        rating: 4.9,
        reviews: 21,
        image: IMAGES.kintsugiPlate,
      },
      {
        title: "Kodak vintage camera",
        condition: "Well-loved",
        price: 68,
        originalPrice: 85,
        rating: 4.8,
        reviews: 34,
        image: IMAGES.vintageCamera,
      },
      {
        title: "Shelf of vintage curiosities",
        condition: "Varies by piece",
        price: 35,
        originalPrice: null,
        rating: 4.5,
        reviews: 9,
        image: IMAGES.vintageTrinkets,
      },
    ],
  },
];

export function getCategory(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug);
}

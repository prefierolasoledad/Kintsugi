/**
 * Seeds the catalog that used to live hardcoded in the frontend
 * (frontend/src/lib/listings.ts) into the database.
 *
 * Safe to re-run: every write is an upsert keyed on a unique column, so this
 * converges rather than duplicating.
 *
 * Ratings are NOT seeded as numbers. Review rows are created and the aggregate
 * is computed from them, so a displayed rating always corresponds to real rows.
 * The counts are therefore smaller and more honest than the invented ones the
 * mock data used to show.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Condition, ListingStatus, VerificationStatus } from "../src/generated/prisma/enums";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Same Unsplash URL shape the frontend uses, kept in one place. */
function unsplash(id: string, params = "w=1600&q=80&auto=format&fit=crop") {
  return `https://images.unsplash.com/photo-${id}?${params}`;
}

const IMAGES = {
  clothingRack: unsplash("1637228393246-c38a4b3d2011"),
  antiqueFurniture: unsplash("1758380742318-4074cce52ec4"),
  vinylRecords: unsplash("1760302318625-cbe999965d8a"),
  vintageTrinkets: unsplash("1767338718786-92f7934e925e"),
  kintsugiPlate: unsplash("1622021134395-d26aab83c221"),
  vintageCamera: unsplash("1741555165521-4c9e762fb2e8"),
  recordPlayer: unsplash("1766592946837-ab4454c4a8a3"),
  leatherJacket: unsplash("1623854156816-4c4fc355ffc7"),
  midCenturyChairs: unsplash("1718049719688-764249c6800d"),
  vintageTypewriter: unsplash("1550777006-9ee6c430227d"),
  vintageBicycle: unsplash("1743087177786-c580de98fbd8"),
  brassLamp: unsplash("1551806406-553417833005"),
  stackOfBooks: unsplash("1755621019856-a22fe8db1292"),
};

/**
 * Seed accounts exist to own rows, not to be logged into. Each gets a random
 * password that is never recorded anywhere, which leaves them effectively
 * login-disabled rather than sharing a known weak credential.
 */
async function unguessableHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
}

const CATEGORIES = [
  {
    slug: "furniture-home",
    title: "Furniture & Home",
    description: "Solid wood, well-worn, built before things were made to be replaced.",
    coverImage: IMAGES.antiqueFurniture,
  },
  {
    slug: "clothing-accessories",
    title: "Clothing & Accessories",
    description: "Vintage and pre-loved pieces, picked for cut and quality.",
    coverImage: IMAGES.clothingRack,
  },
  {
    slug: "music-film-books",
    title: "Music, Film & Books",
    description: "Vinyl, film, and paperbacks that already found one good home.",
    coverImage: IMAGES.vinylRecords,
  },
  {
    slug: "decor-curiosities",
    title: "Décor & Curiosities",
    description: "Small objects with more history than a price tag can explain.",
    coverImage: IMAGES.vintageTrinkets,
  },
  {
    // New: the mock data had a bicycle that belonged to none of the four
    // original categories, and a required categoryId shouldn't be satisfied by
    // filing it somewhere it doesn't fit.
    slug: "bikes-outdoors",
    title: "Bikes & Outdoors",
    description: "Frames with rust and stories. Made to be ridden, not displayed.",
    coverImage: IMAGES.vintageBicycle,
  },
];

type SeedListing = {
  slug: string;
  title: string;
  description: string;
  categorySlug: string;
  condition: Condition;
  conditionNote: string;
  priceCents: number;
  originalPriceCents: number | null;
  quantity: number;
  image: string;
  /// Backdates createdAt so "Recently listed" is a real date sort rather than
  /// whatever order the seed happened to insert in.
  daysAgo: number;
  /// Hand-picked for the "Picked for you" shelf. Curation, not personalisation.
  featured: boolean;
  reviews: Array<{ rating: number; body: string }>;
};

const LISTINGS: SeedListing[] = [
  {
    slug: "mid-century-armchair-pair",
    title: "Mid-century armchair pair",
    description:
      "A matched pair, reupholstered once already. The frames are solid; the left arm has a scuff we didn't sand out.",
    categorySlug: "furniture-home",
    condition: Condition.GOOD,
    conditionNote: "Minor wear",
    priceCents: 31000,
    originalPriceCents: null,
    quantity: 1,
    image: IMAGES.midCenturyChairs,
    daysAgo: 4,
    featured: false,
    reviews: [
      { rating: 5, body: "Frames are genuinely solid. The scuff is exactly where they said it was." },
      { rating: 5, body: "Comfortable and the proportions are lovely in a small room." },
      { rating: 4, body: "Upholstery is a slightly different shade than the photos in daylight." },
      { rating: 5, body: "Arrived well packed. Would buy from this shop again." },
    ],
  },
  {
    slug: "antique-glass-display-cabinet",
    title: "Antique glass display cabinet",
    description:
      "Original glass, original key. One hinge sits slightly low — it closes, but it tells you it's old.",
    categorySlug: "furniture-home",
    condition: Condition.WELL_LOVED,
    conditionNote: "Well-loved",
    priceCents: 24000,
    originalPriceCents: 28000,
    quantity: 1,
    image: IMAGES.antiqueFurniture,
    daysAgo: 14,
    featured: false,
    reviews: [
      { rating: 5, body: "The original key still works, which I did not expect." },
      { rating: 4, body: "Hinge is as described. Fixed it myself in ten minutes." },
      { rating: 4, body: "Beautiful piece, though heavier than I planned for." },
    ],
  },
  {
    slug: "brass-three-light-floor-lamp",
    title: "Brass three-light floor lamp",
    description:
      "Rewired to modern spec. The brass has gone soft and uneven in the way only decades do.",
    categorySlug: "furniture-home",
    condition: Condition.WELL_LOVED,
    conditionNote: "Well-loved",
    priceCents: 7200,
    originalPriceCents: 9000,
    quantity: 1,
    image: IMAGES.brassLamp,
    daysAgo: 12,
    featured: true,
    reviews: [
      { rating: 5, body: "Rewiring is clean and properly earthed. Light is warm and even." },
      { rating: 4, body: "Patina is uneven, which is the appeal, but worth knowing." },
      { rating: 5, body: "Heavier base than modern lamps. Feels like it will outlive me." },
    ],
  },
  {
    slug: "brown-leather-jacket",
    title: "Brown leather jacket",
    description:
      "Barely worn. The leather has just started to give at the elbows, which is where it gets good.",
    categorySlug: "clothing-accessories",
    condition: Condition.LIKE_NEW,
    conditionNote: "Like new",
    priceCents: 12000,
    originalPriceCents: 15000,
    quantity: 1,
    image: IMAGES.leatherJacket,
    daysAgo: 3,
    featured: false,
    reviews: [
      { rating: 5, body: "Almost no wear. The leather is soft without being thin." },
      { rating: 5, body: "Sizing ran true to the measurements listed." },
      { rating: 4, body: "Faint storage smell on arrival that aired out in a day." },
      { rating: 5, body: "Best condition secondhand jacket I've bought." },
      { rating: 5, body: "Lining is intact, zip runs smoothly." },
    ],
  },
  {
    slug: "assorted-vintage-outerwear-rack",
    title: "Assorted vintage outerwear rack",
    description:
      "A mixed rack, priced per piece. Condition varies — check the photos before you commit.",
    categorySlug: "clothing-accessories",
    condition: Condition.GOOD,
    conditionNote: "Varies by piece",
    priceCents: 4500,
    originalPriceCents: null,
    quantity: 12,
    image: IMAGES.clothingRack,
    daysAgo: 20,
    featured: false,
    reviews: [
      { rating: 4, body: "Got two coats, both better than expected for the price." },
      { rating: 4, body: "Condition really does vary. Ask for photos of the specific piece." },
      { rating: 5, body: "Great value if you're willing to sort through." },
    ],
  },
  {
    slug: "retro-record-player",
    title: "Retro record player",
    description:
      "Belt replaced, stylus new, tested end to end. Casing has ring marks from a life on a side table.",
    categorySlug: "music-film-books",
    condition: Condition.GOOD,
    conditionNote: "Fully working",
    priceCents: 14500,
    originalPriceCents: null,
    quantity: 1,
    image: IMAGES.recordPlayer,
    daysAgo: 2,
    featured: false,
    reviews: [
      { rating: 5, body: "Plays perfectly out of the box. New belt makes a real difference." },
      { rating: 5, body: "Speed is stable at both 33 and 45." },
      { rating: 4, body: "Ring marks are more visible in person, but it works beautifully." },
      { rating: 5, body: "Sounds far better than the price suggests." },
    ],
  },
  {
    slug: "crate-of-vinyl-records",
    title: "Crate of vinyl records",
    description:
      "Sleeves are worn, records play clean. A few have previous owners' names inked on the corner.",
    categorySlug: "music-film-books",
    condition: Condition.WELL_LOVED,
    conditionNote: "Well-loved",
    priceCents: 6000,
    originalPriceCents: 7500,
    quantity: 1,
    image: IMAGES.vinylRecords,
    daysAgo: 10,
    featured: false,
    reviews: [
      { rating: 5, body: "Sleeves are rough but every record played without a skip." },
      { rating: 4, body: "A couple of duplicates, still worth it overall." },
      { rating: 5, body: "The inked names are part of the charm, honestly." },
    ],
  },
  {
    slug: "stack-of-well-read-paperbacks",
    title: "Stack of well-read paperbacks",
    description: "Cracked spines and dog-eared corners. Someone read every one of these properly.",
    categorySlug: "music-film-books",
    condition: Condition.WELL_LOVED,
    conditionNote: "Varies by piece",
    priceCents: 2400,
    originalPriceCents: null,
    quantity: 1,
    image: IMAGES.stackOfBooks,
    daysAgo: 22,
    featured: true,
    reviews: [
      { rating: 5, body: "Exactly as described — well read, all readable." },
      { rating: 4, body: "One had underlining throughout. Didn't bother me." },
      { rating: 5, body: "Lovely mix of titles for the money." },
    ],
  },
  {
    slug: "kintsugi-repaired-ceramic-plate",
    title: "Kintsugi-repaired ceramic plate",
    description:
      "Broken, then repaired with gold lacquer. The seam is the point — it's not hidden and it isn't meant to be.",
    categorySlug: "decor-curiosities",
    condition: Condition.WELL_LOVED,
    conditionNote: "Repaired, displayed",
    priceCents: 9500,
    originalPriceCents: null,
    quantity: 1,
    image: IMAGES.kintsugiPlate,
    daysAgo: 6,
    featured: false,
    reviews: [
      { rating: 5, body: "The repair is the best part. Gold work is neat and deliberate." },
      { rating: 5, body: "Display piece rather than tableware, as you'd expect." },
      { rating: 5, body: "Genuinely beautiful. Photographs don't quite catch it." },
      { rating: 4, body: "Smaller than I pictured — read the dimensions." },
    ],
  },
  {
    slug: "kodak-vintage-camera",
    title: "Kodak vintage camera",
    description:
      "Shutter fires at all speeds. Light seals are original and will want replacing before serious use.",
    categorySlug: "decor-curiosities",
    condition: Condition.WELL_LOVED,
    conditionNote: "Well-loved",
    priceCents: 6800,
    originalPriceCents: 8500,
    quantity: 1,
    image: IMAGES.vintageCamera,
    daysAgo: 1,
    featured: false,
    reviews: [
      { rating: 5, body: "Shutter is accurate. Replaced the seals and it shoots fine." },
      { rating: 4, body: "Needed the seal work they warned about. Fair listing." },
      { rating: 5, body: "Glass is clean, no fungus. Very happy." },
      { rating: 4, body: "Cosmetically worn but mechanically sound." },
    ],
  },
  {
    slug: "shelf-of-vintage-curiosities",
    title: "Shelf of vintage curiosities",
    description: "Sold by the piece. Small things with more history than we can verify.",
    categorySlug: "decor-curiosities",
    condition: Condition.GOOD,
    conditionNote: "Varies by piece",
    priceCents: 3500,
    originalPriceCents: null,
    quantity: 9,
    image: IMAGES.vintageTrinkets,
    daysAgo: 18,
    featured: false,
    reviews: [
      { rating: 4, body: "Picked three pieces, all as pictured." },
      { rating: 5, body: "Lovely oddments. Good for filling a shelf cheaply." },
      { rating: 4, body: "Provenance genuinely unknown, as they say up front." },
    ],
  },
  {
    slug: "vintage-typewriter",
    title: "Vintage typewriter",
    description: "Every key strikes. Ribbon is fresh; the case has the dents you'd expect.",
    categorySlug: "decor-curiosities",
    condition: Condition.GOOD,
    conditionNote: "Fully working",
    priceCents: 8800,
    originalPriceCents: 11000,
    quantity: 1,
    image: IMAGES.vintageTypewriter,
    daysAgo: 8,
    featured: true,
    reviews: [
      { rating: 5, body: "Every key really does strike. Ribbon was new as promised." },
      { rating: 5, body: "Types cleanly with no sticking. Dents are cosmetic." },
      { rating: 4, body: "Loud, in the way these are supposed to be." },
      { rating: 5, body: "Arrived double-boxed. Clearly packed with care." },
    ],
  },
  {
    slug: "rusted-frame-vintage-bicycle",
    title: "Rusted-frame vintage bicycle",
    description:
      "Sold as-is. The frame is sound, the rust is cosmetic, and the drivetrain needs a full tune-up.",
    categorySlug: "bikes-outdoors",
    condition: Condition.NEEDS_REPAIR,
    conditionNote: "Needs a tune-up",
    priceCents: 5500,
    originalPriceCents: null,
    quantity: 1,
    image: IMAGES.vintageBicycle,
    daysAgo: 16,
    featured: true,
    reviews: [
      { rating: 4, body: "Frame is straight and sound. Rust really is surface only." },
      { rating: 4, body: "Needed a full drivetrain service, exactly as stated. No surprises." },
      { rating: 3, body: "Honest listing, but budget for the tune-up on top." },
    ],
  },
];

const REVIEWERS = [
  "Ava Lindqvist",
  "Noah Brenner",
  "Priya Raghavan",
  "Marcus Okonjo",
  "Elena Duarte",
  "Sam Whitfield",
  "Yuki Tanabe",
  "Rosa Ferreira",
  "Dev Malhotra",
  "Clara Bishop",
  "Tomas Nowak",
  "Iris Kaneko",
];

function reviewerEmail(name: string) {
  return `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`;
}

async function main() {
  console.log("Seeding catalog…");

  // ---- Categories -------------------------------------------------------
  const categoryIdBySlug = new Map<string, string>();
  for (const [position, category] of CATEGORIES.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { ...category, position },
      create: { ...category, position },
    });
    categoryIdBySlug.set(row.slug, row.id);
  }
  console.log(`  categories: ${categoryIdBySlug.size}`);

  // ---- House seller -----------------------------------------------------
  // Seeded listings need an owner, so sellerId can stay non-nullable rather
  // than carrying a "curated listing" special case forever.
  const houseUser = await prisma.user.upsert({
    where: { email: "curation@kintsugi.example" },
    update: { isSeller: true, emailVerified: true },
    create: {
      email: "curation@kintsugi.example",
      name: "Kintsugi Collection",
      passwordHash: await unguessableHash(),
      isSeller: true,
      emailVerified: true,
    },
  });

  const houseSeller = await prisma.sellerProfile.upsert({
    where: { userId: houseUser.id },
    update: {},
    create: {
      userId: houseUser.id,
      shopName: "Kintsugi Collection",
      bio: "Pieces we sourced and checked ourselves. Flaws listed, never hidden.",
      kycStatus: VerificationStatus.VERIFIED,
      kycProvider: "seed",
      kycVerifiedAt: new Date(),
      payoutsEnabled: true,
    },
  });
  console.log(`  house seller: ${houseSeller.shopName}`);

  // ---- Reviewer accounts ------------------------------------------------
  const reviewerIds: string[] = [];
  for (const name of REVIEWERS) {
    const user = await prisma.user.upsert({
      where: { email: reviewerEmail(name) },
      update: {},
      create: {
        email: reviewerEmail(name),
        name,
        passwordHash: await unguessableHash(),
        emailVerified: true,
      },
    });
    reviewerIds.push(user.id);
  }
  console.log(`  reviewers: ${reviewerIds.length}`);

  // ---- Listings, images, reviews ---------------------------------------
  let reviewCount = 0;
  for (const [index, listing] of LISTINGS.entries()) {
    const categoryId = categoryIdBySlug.get(listing.categorySlug);
    if (!categoryId) throw new Error(`Unknown category: ${listing.categorySlug}`);

    const createdAt = new Date(Date.now() - listing.daysAgo * 24 * 60 * 60 * 1000);
    const shared = {
      title: listing.title,
      description: listing.description,
      categoryId,
      condition: listing.condition,
      conditionNote: listing.conditionNote,
      priceCents: listing.priceCents,
      originalPriceCents: listing.originalPriceCents,
      quantity: listing.quantity,
      status: ListingStatus.ACTIVE,
      featured: listing.featured,
      createdAt,
    };

    const row = await prisma.listing.upsert({
      where: { slug: listing.slug },
      update: shared,
      create: { slug: listing.slug, sellerId: houseSeller.id, ...shared },
    });

    // Cover image. Replaced wholesale so re-seeding can't stack duplicates.
    await prisma.listingImage.deleteMany({ where: { listingId: row.id } });
    await prisma.listingImage.create({
      data: { listingId: row.id, url: listing.image, alt: listing.title, position: 0 },
    });

    // Distinct author per listing, required by the [listingId, authorId] unique.
    for (const [i, review] of listing.reviews.entries()) {
      const authorId = reviewerIds[(index * 3 + i) % reviewerIds.length];
      await prisma.review.upsert({
        where: { listingId_authorId: { listingId: row.id, authorId } },
        update: { rating: review.rating, body: review.body },
        create: { listingId: row.id, authorId, rating: review.rating, body: review.body },
      });
      reviewCount++;
    }
  }
  console.log(`  listings: ${LISTINGS.length}`);
  console.log(`  reviews: ${reviewCount}`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

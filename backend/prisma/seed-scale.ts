import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Condition, ListingStatus, VerificationStatus } from "../src/generated/prisma/enums";

/**
 * Bulk catalog, for load testing.
 *
 * 30 seller accounts × 30 listings = 900 listings, on top of whatever is
 * already there.
 *
 * WHAT THIS DOES AND DOESN'T DEMONSTRATE
 * It does not make Postgres struggle. 900 rows — or 900,000 — is not a load
 * problem; an unindexed query or a few hundred concurrent readers is. What this
 * gives you is a catalog big enough that a load test means something: real
 * pagination, real sort costs, a working set that doesn't fit in a single page
 * of results. The replication argument is made by hammering it and by killing
 * the primary, not by counting rows.
 *
 * ADDITIVE AND REVERSIBLE
 * Deliberately not part of `prisma db seed`, which resets. This only ever adds
 * accounts under a reserved prefix, and `--clean` removes exactly those. Real
 * orders, holds, and wishlists are never touched.
 *
 *   npm run seed:scale           add (idempotent — safe to re-run)
 *   npm run seed:scale -- --clean   remove everything it created
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Reserved so cleanup can never catch a real account. */
const SELLER_PREFIX = "scale.seller";
const REVIEWER_PREFIX = "scale.reviewer";
const DOMAIN = "@kintsugi.example";

const SELLERS = 30;
const LISTINGS_PER_SELLER = 30;
const REVIEWERS = 24;

/**
 * Deterministic PRNG (mulberry32), so re-running produces byte-identical data.
 * Math.random would make every run a different catalog, which makes an
 * idempotent upsert meaningless and load results incomparable.
 */
function rng(seed: number) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260825);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function unsplash(id: string, params = "w=1600&q=80&auto=format&fit=crop") {
  return `https://images.unsplash.com/photo-${id}?${params}`;
}

/**
 * Every id here is already used by the main seed, which means each was checked
 * to return a real image from images.unsplash.com rather than Unsplash+.
 * Photos repeat across the 900 — that is the honest cost of generated data, and
 * better than shipping unverified ids or broken links.
 */
const PHOTOS: Record<string, string[]> = {
  "furniture-home": ["1758380742318-4074cce52ec4", "1718049719688-764249c6800d", "1551806406-553417833005"],
  "clothing-accessories": ["1637228393246-c38a4b3d2011", "1623854156816-4c4fc355ffc7", "1602082805057-3c32f79817a1", "1616244916660-d135a013d1f8"],
  "music-film-books": ["1760302318625-cbe999965d8a", "1766592946837-ab4454c4a8a3", "1755621019856-a22fe8db1292", "1616146649085-a11fb216f170", "1611001716885-b3402558a62b"],
  "decor-curiosities": ["1767338718786-92f7934e925e", "1622021134395-d26aab83c221", "1550777006-9ee6c430227d", "1465385076216-9288f6f0584b", "1525598912003-663126343e1f"],
  "bikes-outdoors": ["1743087177786-c580de98fbd8", "1684487747385-442d674962f2", "1509762774605-f07235a08f1f", "1711118882380-085ab7f04f92"],
  "kitchen-tableware": ["1560131324-71022d71ee4f", "1577930143935-a9489e4f34ec", "1716757025967-5548360464b4", "1551497406-3e4e11919f7a"],
  electronics: ["1741555165521-4c9e762fb2e8", "1756622584764-94eaa382652e", "1611001716885-b3402558a62b", "1525598912003-663126343e1f"],
};

/** Titles are assembled rather than listed, because 900 hand-written ones is
 *  not a good use of anyone's time. Kept plausible: no "Product 417". */
const WORDS: Record<string, { adj: string[]; noun: string[]; price: [number, number] }> = {
  "furniture-home": {
    adj: ["Oak", "Teak", "Walnut", "Pine", "Rattan", "Mid-century", "Danish", "Reclaimed", "Painted", "Bentwood"],
    noun: ["dining chair", "side table", "bookcase", "writing desk", "dresser", "footstool", "coffee table", "armchair", "sideboard", "plant stand", "mirror", "bed frame"],
    price: [4500, 48000],
  },
  "clothing-accessories": {
    adj: ["Wool", "Corduroy", "Leather", "Linen", "Tweed", "Denim", "Suede", "Cashmere", "Waxed cotton", "Silk"],
    noun: ["overcoat", "blazer", "work jacket", "shirt", "scarf", "satchel", "boots", "cardigan", "trousers", "gloves", "belt", "handbag"],
    price: [1800, 22000],
  },
  "music-film-books": {
    adj: ["Original-pressing", "Reissued", "First-edition", "Boxed", "Hardback", "Import", "Mono", "Well-thumbed", "Signed", "Complete"],
    noun: ["jazz LP", "soul 7-inch", "poetry collection", "cookbook", "film reel", "paperback set", "vinyl bundle", "art monograph", "cassette lot", "atlas", "comic run", "novel"],
    price: [800, 14000],
  },
  "decor-curiosities": {
    adj: ["Brass", "Enamel", "Hand-painted", "Etched", "Porcelain", "Carved", "Stoneware", "Milk-glass", "Wrought-iron", "Beaded"],
    noun: ["candlestick", "wall clock", "jewellery box", "vase", "picture frame", "tin sign", "letter rack", "figurine", "map print", "trinket dish", "bookend pair", "lamp base"],
    price: [900, 16000],
  },
  "bikes-outdoors": {
    adj: ["Steel-framed", "Touring", "Vintage racing", "Folding", "Canvas", "Aluminium", "Waxed", "Three-speed", "Lugged", "Expedition"],
    noun: ["road bike", "commuter bike", "rucksack", "two-person tent", "sleeping bag", "pannier set", "camp stove", "tennis racket", "walking poles", "bike frame", "helmet", "cool box"],
    price: [2500, 62000],
  },
  "kitchen-tableware": {
    adj: ["Cast-iron", "Copper", "Stoneware", "Pyrex", "Enamelled", "Hand-thrown", "Pressed-glass", "Stainless", "Terracotta", "Bone-china"],
    noun: ["skillet", "casserole dish", "mixing bowl set", "teapot", "dinner plates", "tumblers", "serving platter", "storage jars", "cake tin", "coffee pot", "cutlery set", "mugs"],
    price: [1200, 19000],
  },
  electronics: {
    adj: ["Working", "Serviced", "Boxed", "Untested", "Refurbished", "Portable", "Valve", "Compact", "Battery", "Mains"],
    noun: ["film camera", "transistor radio", "cassette deck", "turntable", "desk fan", "record player", "slide projector", "amplifier", "rotary phone", "calculator", "speakers", "light meter"],
    price: [1500, 42000],
  },
};

const CONDITION_NOTES: Record<string, string[]> = {
  LIKE_NEW: ["Barely used", "As new", "Hardly touched", "Immaculate"],
  GOOD: ["Minor wear", "Light marks", "Solid condition", "Good working order"],
  WELL_LOVED: ["Well used", "Honest wear", "Marks throughout", "Shows its age"],
  NEEDS_REPAIR: ["Needs a tune-up", "Sold as seen", "For parts or repair", "Needs attention"],
};

const CONDITIONS = [
  Condition.LIKE_NEW,
  Condition.GOOD,
  Condition.GOOD,
  Condition.GOOD,
  Condition.WELL_LOVED,
  Condition.WELL_LOVED,
  Condition.NEEDS_REPAIR,
] as const;

const SHOP_WORDS_A = ["Second", "Salt", "Copper", "Vellum", "Harbour", "Ash", "Linden", "Marlow", "Thistle", "Bramble", "Quarry", "Ember", "Hollow", "Wren", "Fen"];
const SHOP_WORDS_B = ["Life", "& Pine", "Row", "Attic", "Trading Co.", "Yard", "Emporium", "Finds", "Salvage", "Rooms", "Wares", "Curios", "Depot", "Loft", "Store"];

const REVIEW_BODIES = [
  "Exactly as described. Packed carefully.",
  "Better in person than the photos suggest.",
  "Some wear, all of it disclosed up front. Happy.",
  "Quick to post and answered my questions.",
  "Lovely piece. Would buy from this shop again.",
  "Arrived well wrapped and on time.",
  "Solid and honest. No surprises.",
  "Slightly more worn than I expected, but fairly described.",
  "Great find. The photos didn't do it justice.",
  "Seller was straight with me about the damage.",
];

async function unguessableHash() {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ------------------------------------------------------------------ */

async function clean() {
  console.log("Removing bulk seed data…\n");

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { startsWith: SELLER_PREFIX } },
        { email: { startsWith: REVIEWER_PREFIX } },
      ],
      email: { endsWith: DOMAIN },
    },
    select: { id: true, email: true },
  });

  if (users.length === 0) {
    console.log("  nothing to remove");
    return;
  }

  const listings = await prisma.listing.count({
    where: { seller: { userId: { in: users.map((u) => u.id) } } },
  });

  // Cascades through SellerProfile -> Listing -> images/reviews/reservations.
  const deleted = await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });

  console.log(`  removed ${deleted.count} accounts and ${listings} listings`);
  console.log(`  remaining listings: ${await prisma.listing.count()}`);
}

async function seed() {
  const categories = await prisma.category.findMany({ select: { id: true, slug: true } });
  if (categories.length === 0) {
    throw new Error("No categories. Run `npx prisma db seed` first.");
  }
  const categoryIds = new Map(categories.map((c) => [c.slug, c.id]));
  const catSlugs = categories.map((c) => c.slug).filter((s) => WORDS[s]);

  const before = await prisma.listing.count();
  console.log(`Starting from ${before} listings.\n`);

  /* ---- sellers ---- */
  console.log(`Creating ${SELLERS} seller accounts…`);
  const passwordHash = await unguessableHash();
  const sellerProfileIds: string[] = [];

  for (let i = 1; i <= SELLERS; i++) {
    const n = String(i).padStart(2, "0");
    const email = `${SELLER_PREFIX}${n}${DOMAIN}`;
    const shopName = `${SHOP_WORDS_A[(i - 1) % SHOP_WORDS_A.length]} ${SHOP_WORDS_B[(i * 7 - 1) % SHOP_WORDS_B.length]}`;

    // Two thirds verified, so the verified badge means something on the page
    // rather than being universal decoration.
    const verified = i % 3 !== 0;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: shopName,
        passwordHash,
        isSeller: true,
        emailVerified: true,
      },
      select: { id: true },
    });

    const profile = await prisma.sellerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        shopName,
        bio: "Clearing out slowly, listing the good bits.",
        kycStatus: verified ? VerificationStatus.VERIFIED : VerificationStatus.UNSTARTED,
        kycProvider: verified ? "seed" : null,
        kycVerifiedAt: verified ? new Date() : null,
        payoutsEnabled: verified,
      },
      select: { id: true },
    });

    sellerProfileIds.push(profile.id);
  }
  console.log(`  ${sellerProfileIds.length} sellers ready`);

  /* ---- reviewers ---- */
  console.log(`Creating ${REVIEWERS} reviewer accounts…`);
  const reviewerIds: string[] = [];
  for (let i = 1; i <= REVIEWERS; i++) {
    const n = String(i).padStart(2, "0");
    const user = await prisma.user.upsert({
      where: { email: `${REVIEWER_PREFIX}${n}${DOMAIN}` },
      update: {},
      create: {
        email: `${REVIEWER_PREFIX}${n}${DOMAIN}`,
        name: `Buyer ${n}`,
        passwordHash,
        emailVerified: true,
      },
      select: { id: true },
    });
    reviewerIds.push(user.id);
  }
  console.log(`  ${reviewerIds.length} reviewers ready`);

  /* ---- listings ---- */
  const total = SELLERS * LISTINGS_PER_SELLER;
  console.log(`\nBuilding ${total} listings…`);

  type Row = {
    slug: string;
    title: string;
    description: string;
    sellerId: string;
    categoryId: string;
    condition: (typeof CONDITIONS)[number];
    conditionNote: string;
    priceCents: number;
    originalPriceCents: number | null;
    currency: string;
    quantity: number;
    status: ListingStatus;
    featured: boolean;
    createdAt: Date;
    photo: string;
    photoAlt: string;
  };

  const rows: Row[] = [];

  for (let s = 0; s < SELLERS; s++) {
    for (let k = 0; k < LISTINGS_PER_SELLER; k++) {
      const catSlug = catSlugs[(s * LISTINGS_PER_SELLER + k) % catSlugs.length];
      const bank = WORDS[catSlug];
      const adj = pick(bank.adj);
      const noun = pick(bank.noun);
      const title = `${adj} ${noun}`;

      const condition = pick(CONDITIONS);
      const conditionNote = pick(CONDITION_NOTES[condition]);

      const priceCents = between(bank.price[0], bank.price[1]);
      // A third are marked down, which is what makes the discount badge and the
      // "was" price on a card worth rendering at all.
      const discounted = rand() < 0.34;
      const originalPriceCents = discounted
        ? Math.round(priceCents * (1.15 + rand() * 0.5))
        : null;

      const photos = PHOTOS[catSlug];
      const photo = photos[(s + k) % photos.length];

      rows.push({
        // Slug carries the seller and item index, so two sellers can both list
        // an "Oak dining chair" without colliding.
        slug: `${slugify(title)}-s${String(s + 1).padStart(2, "0")}-${String(k + 1).padStart(2, "0")}`,
        title,
        description:
          `${adj} ${noun}, picked up second-hand and listed as found. ` +
          `${conditionNote}. Happy to send more photos of anything specific before you buy.`,
        sellerId: sellerProfileIds[s],
        categoryId: categoryIds.get(catSlug)!,
        condition,
        conditionNote,
        priceCents,
        originalPriceCents,
        currency: "USD",
        // Mostly one-of-a-kind, which is the premise of the whole site.
        quantity: rand() < 0.85 ? 1 : between(2, 4),
        status: ListingStatus.ACTIVE,
        featured: rand() < 0.05,
        // Spread across six months so "recently listed" is a real sort rather
        // than 900 rows sharing one timestamp.
        createdAt: new Date(Date.now() - Math.floor(rand() * 180) * 86_400_000),
        photo: unsplash(photo),
        photoAlt: `${title}, photographed on a plain background`,
      });
    }
  }

  console.log("Inserting listings…");
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = await prisma.listing.createMany({
      data: chunk.map(({ photo, photoAlt, ...rest }) => rest),
      // Makes re-running a no-op instead of an error.
      skipDuplicates: true,
    });
    inserted += result.count;
    process.stdout.write(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}\r`);
  }
  console.log(`\n  inserted ${inserted} new listings`);

  /* ---- images ---- */
  console.log("Attaching images…");
  const created = await prisma.listing.findMany({
    where: { slug: { in: rows.map((r) => r.slug) } },
    select: { id: true, slug: true },
  });
  const idBySlug = new Map(created.map((l) => [l.slug, l.id]));

  const withImages = new Set(
    (
      await prisma.listingImage.findMany({
        where: { listingId: { in: created.map((l) => l.id) } },
        select: { listingId: true },
        distinct: ["listingId"],
      })
    ).map((r) => r.listingId)
  );

  const imageRows = rows
    .map((r) => ({ listingId: idBySlug.get(r.slug)!, url: r.photo, alt: r.photoAlt, position: 0 }))
    .filter((r) => r.listingId && !withImages.has(r.listingId));

  for (let i = 0; i < imageRows.length; i += CHUNK) {
    await prisma.listingImage.createMany({ data: imageRows.slice(i, i + CHUNK) });
    process.stdout.write(`  ${Math.min(i + CHUNK, imageRows.length)}/${imageRows.length}\r`);
  }
  console.log(`\n  attached ${imageRows.length} images`);

  /* ---- reviews ---- */
  console.log("Adding reviews…");
  const withReviews = new Set(
    (
      await prisma.review.findMany({
        where: { listingId: { in: created.map((l) => l.id) } },
        select: { listingId: true },
        distinct: ["listingId"],
      })
    ).map((r) => r.listingId)
  );

  const reviewRows: { listingId: string; authorId: string; rating: number; body: string }[] = [];
  for (const r of rows) {
    const listingId = idBySlug.get(r.slug);
    if (!listingId || withReviews.has(listingId)) continue;

    // A fifth have none, so "No reviews yet" stays a real state on the card.
    if (rand() < 0.2) continue;

    const count = between(1, 4);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const authorId = reviewerIds[Math.floor(rand() * reviewerIds.length)];
      // The unique index is [listingId, authorId]; one person, one review.
      if (used.has(authorId)) continue;
      used.add(authorId);
      reviewRows.push({
        listingId,
        authorId,
        rating: rand() < 0.62 ? 5 : rand() < 0.75 ? 4 : between(2, 3),
        body: pick(REVIEW_BODIES),
      });
    }
  }

  for (let i = 0; i < reviewRows.length; i += CHUNK) {
    await prisma.review.createMany({ data: reviewRows.slice(i, i + CHUNK), skipDuplicates: true });
    process.stdout.write(`  ${Math.min(i + CHUNK, reviewRows.length)}/${reviewRows.length}\r`);
  }
  console.log(`\n  added ${reviewRows.length} reviews`);

  /* ---- summary ---- */
  const after = await prisma.listing.count();
  const active = await prisma.listing.count({ where: { status: ListingStatus.ACTIVE } });
  console.log(`\nListings: ${before} -> ${after} (${active} active)`);
  console.log(`Sellers:  ${await prisma.sellerProfile.count()}`);
  console.log(`Reviews:  ${await prisma.review.count()}`);
}

async function main() {
  const wantsClean = process.argv.includes("--clean");
  if (wantsClean) await clean();
  else await seed();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

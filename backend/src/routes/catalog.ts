import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ListingStatus, VerificationStatus } from "../generated/prisma/enums";

export const catalogRouter = Router();

/** Only listings that are actually buyable should ever surface in the catalog. */
const VISIBLE = { status: ListingStatus.ACTIVE, deletedAt: null } as const;

const listingInclude = {
  category: { select: { slug: true, title: true } },
  seller: { select: { shopName: true, kycStatus: true } },
  images: {
    orderBy: { position: "asc" as const },
    select: { url: true, alt: true, position: true },
  },
};

/**
 * Structural rather than derived from Prisma's generated namespace — it accepts
 * the query result either way and keeps this module readable.
 */
type ListingRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  condition: string;
  conditionNote: string | null;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  quantity: number;
  featured: boolean;
  createdAt: Date;
  category: { slug: string; title: string };
  seller: { shopName: string; kycStatus: string };
  images: { url: string; alt: string | null; position: number }[];
};

type RatingAgg = { average: number | null; count: number };

const NO_RATING: RatingAgg = { average: null, count: 0 };

/**
 * Ratings are computed from review rows rather than stored on the listing, so a
 * displayed score always traces back to real reviews. One grouped query covers
 * a whole page of results.
 */
async function ratingsFor(listingIds: string[]): Promise<Map<string, RatingAgg>> {
  if (listingIds.length === 0) return new Map();

  const grouped = await prisma.review.groupBy({
    by: ["listingId"],
    where: { listingId: { in: listingIds } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return new Map(
    grouped.map((g) => [
      g.listingId,
      {
        average: g._avg.rating === null ? null : Math.round(g._avg.rating * 10) / 10,
        count: g._count.rating,
      },
    ])
  );
}

function serializeListing(row: ListingRow, rating: RatingAgg) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    condition: row.condition,
    conditionNote: row.conditionNote,
    priceCents: row.priceCents,
    originalPriceCents: row.originalPriceCents,
    currency: row.currency,
    quantity: row.quantity,
    // Exposed so a detail page can say "on hold" or "sold" instead of
    // pretending an unavailable item is buyable.
    status: row.status,
    featured: row.featured,
    createdAt: row.createdAt.toISOString(),
    category: row.category,
    seller: {
      shopName: row.seller.shopName,
      // Surfaced so buyers can see identity-verified sellers. Never exposes any
      // part of the underlying verification record.
      verified: row.seller.kycStatus === VerificationStatus.VERIFIED,
    },
    images: row.images,
    rating,
  };
}

catalogRouter.get("/categories", async (_req, res) => {
  try {
    const rows = await prisma.category.findMany({
      orderBy: { position: "asc" },
      include: { _count: { select: { listings: { where: VISIBLE } } } },
    });

    res.json({
      categories: rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        title: c.title,
        description: c.description,
        coverImage: c.coverImage,
        listingCount: c._count.listings,
      })),
    });
  } catch (err) {
    console.error("GET /catalog/categories failed", err);
    res.status(500).json({ error: "Could not load categories." });
  }
});

const CONDITIONS = ["LIKE_NEW", "GOOD", "WELL_LOVED", "NEEDS_REPAIR"] as const;

const listQuery = z.object({
  category: z.string().trim().max(64).optional(),
  condition: z.enum(CONDITIONS).optional(),
  // Prices arrive in whole currency units because that is what the filter UI
  // collects. Converted to integer minor units before touching the database.
  minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
  maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
  q: z.string().trim().max(120).optional(),
  featured: z.enum(["true", "false"]).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

const ORDER_BY = {
  newest: [{ createdAt: "desc" as const }, { id: "asc" as const }],
  price_asc: [{ priceCents: "asc" as const }, { id: "asc" as const }],
  price_desc: [{ priceCents: "desc" as const }, { id: "asc" as const }],
};

catalogRouter.get("/listings", async (req, res) => {
  try {
    // The filter form submits unset fields as empty strings; treat those as absent
    // rather than rejecting the whole request.
    const cleaned = Object.fromEntries(
      Object.entries(req.query).filter(([, v]) => v !== "" && v !== undefined)
    );

    const parsed = listQuery.safeParse(cleaned);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid search parameters.", code: "INVALID_QUERY" });
    }

    const { category, condition, minPrice, maxPrice, q, featured, sort, page, limit } =
      parsed.data;

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      return res.status(400).json({
        error: "Minimum price can't be higher than maximum price.",
        code: "INVALID_PRICE_RANGE",
        field: "minPrice",
      });
    }

    const where = {
      ...VISIBLE,
      ...(category ? { category: { slug: category } } : {}),
      ...(condition ? { condition } : {}),
      ...(featured ? { featured: featured === "true" } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            priceCents: {
              ...(minPrice !== undefined ? { gte: Math.round(minPrice * 100) } : {}),
              ...(maxPrice !== undefined ? { lte: Math.round(maxPrice * 100) } : {}),
            },
          }
        : {}),
      // Substring matching. Adequate at this scale; a Postgres tsvector index is
      // the upgrade path once the catalog is large enough to need ranking.
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.listing.count({ where }),
      prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: ORDER_BY[sort],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const ratings = await ratingsFor(rows.map((r) => r.id));

    res.json({
      listings: rows.map((r) => serializeListing(r, ratings.get(r.id) ?? NO_RATING)),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("GET /catalog/listings failed", err);
    res.status(500).json({ error: "Could not load listings." });
  }
});

catalogRouter.get("/listings/:slug", async (req, res) => {
  try {
    // Detail pages stay reachable once an item is held or sold — a buyer who
    // holds the last one must still be able to open its page, and a public URL
    // that 404s the moment stock runs out is a broken link. Lists and search
    // continue to show only ACTIVE.
    const row = await prisma.listing.findFirst({
      where: {
        slug: req.params.slug,
        deletedAt: null,
        status: {
          in: [ListingStatus.ACTIVE, ListingStatus.RESERVED, ListingStatus.SOLD],
        },
      },
      include: {
        ...listingInclude,
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            rating: true,
            body: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        },
      },
    });

    if (!row) {
      return res.status(404).json({ error: "Listing not found.", code: "NOT_FOUND" });
    }

    const ratings = await ratingsFor([row.id]);

    const related = await prisma.listing.findMany({
      where: { ...VISIBLE, categoryId: row.categoryId, id: { not: row.id } },
      include: listingInclude,
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    const relatedRatings = await ratingsFor(related.map((r) => r.id));

    res.json({
      listing: {
        ...serializeListing(row, ratings.get(row.id) ?? NO_RATING),
        reviews: row.reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
          authorName: r.author.name,
        })),
      },
      related: related.map((r) =>
        serializeListing(r, relatedRatings.get(r.id) ?? NO_RATING)
      ),
    });
  } catch (err) {
    console.error("GET /catalog/listings/:slug failed", err);
    res.status(500).json({ error: "Could not load listing." });
  }
});

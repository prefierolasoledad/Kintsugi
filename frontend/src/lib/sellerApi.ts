import { ApiError } from "@/lib/api";

export type SellerListingImage = {
  id: string;
  url: string;
  alt: string | null;
  position: number;
};

export type SellerListing = {
  id: string;
  slug: string;
  title: string;
  description: string;
  condition: string;
  conditionNote: string | null;
  priceCents: number;
  originalPriceCents: number | null;
  currency: string;
  quantity: number;
  status: "DRAFT" | "ACTIVE" | "RESERVED" | "SOLD" | "REMOVED";
  featured: boolean;
  createdAt: string;
  updatedAt: string;
  category: { id: string; slug: string; title: string };
  images: SellerListingImage[];
};

export type SellerProfile = {
  id: string;
  shopName: string;
  bio: string | null;
  kycStatus: "UNSTARTED" | "PENDING" | "VERIFIED" | "REJECTED";
  payoutsEnabled: boolean;
  createdAt: string;
};

export type ListingInput = {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  conditionNote?: string | null;
  priceCents: number;
  originalPriceCents?: number | null;
  quantity: number;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/seller${path}`, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...options.headers },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      body.error ?? "Something went wrong. Please try again.",
      body.code,
      body.field
    );
  }

  return body as T;
}

export function getSellerProfile() {
  return request<{ seller: SellerProfile; counts: Record<string, number> }>("/me");
}

export function getSellerListings() {
  return request<{ listings: SellerListing[] }>("/listings");
}

export function getSellerListing(id: string) {
  return request<{ listing: SellerListing }>(`/listings/${id}`);
}

export function createListing(input: ListingInput) {
  return request<{ listing: SellerListing }>("/listings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateListing(id: string, input: Partial<ListingInput>) {
  return request<{ listing: SellerListing }>(`/listings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function publishListing(id: string) {
  return request<{ listing: SellerListing }>(`/listings/${id}/publish`, { method: "POST" });
}

export function unpublishListing(id: string) {
  return request<{ listing: SellerListing }>(`/listings/${id}/unpublish`, { method: "POST" });
}

export function deleteListing(id: string) {
  return request<void>(`/listings/${id}`, { method: "DELETE" });
}

export function uploadListingImage(id: string, file: File) {
  const form = new FormData();
  form.append("image", file);
  return request<{ image: SellerListingImage }>(`/listings/${id}/images`, {
    method: "POST",
    body: form,
  });
}

export function deleteListingImage(id: string, imageId: string) {
  return request<void>(`/listings/${id}/images/${imageId}`, { method: "DELETE" });
}

export type VerificationStatus = "UNSTARTED" | "PENDING" | "VERIFIED" | "REJECTED";

export type Verification = {
  status: VerificationStatus;
  provider: string | null;
  documentType: string | null;
  country: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  payoutsEnabled: boolean;
  /** True when no real identity provider is wired up. Shown to the user. */
  isStub: boolean;
};

export type KycAttempt = {
  id: string;
  provider: string;
  providerSessionId: string;
  status: VerificationStatus;
  documentType: string | null;
  country: string | null;
  rejectionReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type DocumentSubmission = {
  documentType: string;
  country: string;
  documentNumber: string;
};

export function getVerification() {
  return request<{ verification: Verification; attempts: KycAttempt[] }>("/verification");
}

export function startVerification() {
  return request<{
    session: { providerSessionId: string; redirectUrl: string };
    resumed: boolean;
  }>("/verification", { method: "POST" });
}

export function submitVerification(sessionId: string, input: DocumentSubmission) {
  return request<{
    outcome: "VERIFIED" | "REJECTED";
    rejectionReason: string | null;
    payoutsEnabled: boolean;
  }>(`/verification/${sessionId}/submit`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPayouts() {
  return request<{
    payouts: {
      enabled: boolean;
      balanceCents: number;
      currency: string;
      history: unknown[];
      note: string;
    };
  }>("/payouts");
}

export const DOCUMENT_TYPE_OPTIONS = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "national_id", label: "National ID card" },
] as const;

/** Forms collect dollars; the API takes integer minor units. */
export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function centsToDollars(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

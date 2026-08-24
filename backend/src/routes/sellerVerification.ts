import { Router } from "express";
import { z } from "zod";
import { DOCUMENT_TYPES, KYC_PROVIDER, decide, startSession } from "../lib/kycProvider";
import { prisma } from "../lib/prisma";
import { checkRateLimit } from "../lib/rateLimit";
import { requireAuth } from "../middleware/requireAuth";
import { requireSeller } from "../middleware/requireSeller";
import { VerificationStatus } from "../generated/prisma/enums";

/**
 * Identity verification and the payout gate.
 *
 * Verification gates PAYOUTS, not listing creation. That is the Stripe Connect
 * model and what real marketplaces do: authoring a listing is harmless, so
 * blocking it only costs seller onboarding. Money leaving the platform is the
 * step that needs a verified identity behind it.
 */
export const sellerVerificationRouter = Router();

sellerVerificationRouter.use(requireAuth, requireSeller);

function serializeAttempt(a: {
  id: string;
  provider: string;
  providerSessionId: string;
  status: string;
  documentType: string | null;
  country: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: a.id,
    provider: a.provider,
    providerSessionId: a.providerSessionId,
    status: a.status,
    documentType: a.documentType,
    country: a.country,
    rejectionReason: a.rejectionReason,
    createdAt: a.createdAt.toISOString(),
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
  };
}

sellerVerificationRouter.get("/verification", async (req, res) => {
  try {
    const profile = await prisma.sellerProfile.findUnique({
      where: { id: req.sellerId },
      select: {
        kycStatus: true,
        kycProvider: true,
        kycDocType: true,
        kycCountry: true,
        kycVerifiedAt: true,
        kycRejectionReason: true,
        payoutsEnabled: true,
      },
    });

    if (!profile) {
      return res.status(404).json({ error: "Seller profile not found." });
    }

    const attempts = await prisma.kycAttempt.findMany({
      where: { sellerProfileId: req.sellerId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    res.json({
      verification: {
        status: profile.kycStatus,
        provider: profile.kycProvider,
        documentType: profile.kycDocType,
        country: profile.kycCountry,
        verifiedAt: profile.kycVerifiedAt ? profile.kycVerifiedAt.toISOString() : null,
        rejectionReason: profile.kycRejectionReason,
        payoutsEnabled: profile.payoutsEnabled,
        // Surfaced so the UI can label the stub honestly rather than implying a
        // real identity check took place.
        isStub: KYC_PROVIDER === "stub",
      },
      attempts: attempts.map(serializeAttempt),
    });
  } catch (err) {
    console.error("GET /seller/verification failed", err);
    res.status(500).json({ error: "Could not load your verification status." });
  }
});

sellerVerificationRouter.post("/verification", async (req, res) => {
  try {
    const profile = await prisma.sellerProfile.findUnique({
      where: { id: req.sellerId },
      select: { id: true, kycStatus: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Seller profile not found." });
    }

    if (profile.kycStatus === VerificationStatus.VERIFIED) {
      return res
        .status(409)
        .json({ error: "Your identity is already verified.", code: "ALREADY_VERIFIED" });
    }

    // Attempts are capped: the stub decides deterministically from the document
    // number, so an unbounded endpoint would let someone probe for outcomes.
    const limit = checkRateLimit(`kyc:${req.userId}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({
        error: "Too many verification attempts. Try again later.",
        code: "RATE_LIMITED",
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    // An in-flight session is resumed rather than duplicated.
    const pending = await prisma.kycAttempt.findFirst({
      where: { sellerProfileId: profile.id, status: VerificationStatus.PENDING },
      orderBy: { createdAt: "desc" },
    });

    if (pending) {
      return res.json({
        session: {
          providerSessionId: pending.providerSessionId,
          redirectUrl: `/seller/verify/${pending.providerSessionId}`,
        },
        resumed: true,
      });
    }

    const session = startSession();

    await prisma.$transaction([
      prisma.kycAttempt.create({
        data: {
          sellerProfileId: profile.id,
          provider: KYC_PROVIDER,
          providerSessionId: session.providerSessionId,
          status: VerificationStatus.PENDING,
        },
      }),
      prisma.sellerProfile.update({
        where: { id: profile.id },
        data: {
          kycStatus: VerificationStatus.PENDING,
          kycProvider: KYC_PROVIDER,
          kycSessionId: session.providerSessionId,
          kycRejectionReason: null,
        },
      }),
    ]);

    res.status(201).json({ session, resumed: false });
  } catch (err) {
    console.error("POST /seller/verification failed", err);
    res.status(500).json({ error: "Could not start verification." });
  }
});

const submissionBody = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  country: z.string().trim().length(2).toUpperCase(),
  // Read, evaluated, and discarded. Never persisted anywhere — asserted by test.
  documentNumber: z.string().trim().min(6).max(40),
});

/**
 * Applies a provider decision.
 *
 * With a real provider this transition arrives as a signed webhook
 * (identity.verification_session.verified / .requires_input) whose signature we
 * would verify before trusting it. The stub is driven by the seller's own
 * submission instead, which is why the lookup below is scoped to the owner.
 */
sellerVerificationRouter.post("/verification/:sessionId/submit", async (req, res) => {
  try {
    const parsed = submissionBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({
        error: first?.message ?? "Check the details and try again.",
        code: "INVALID_INPUT",
        field: first?.path?.[0] != null ? String(first.path[0]) : undefined,
      });
    }

    // Scoped by sellerProfileId so one seller can never resolve another's session.
    const attempt = await prisma.kycAttempt.findFirst({
      where: {
        providerSessionId: req.params.sessionId,
        sellerProfileId: req.sellerId,
      },
    });

    if (!attempt) {
      return res
        .status(404)
        .json({ error: "Verification session not found.", code: "NOT_FOUND" });
    }
    if (attempt.status !== VerificationStatus.PENDING) {
      return res.status(409).json({
        error: "That verification session is already finished.",
        code: "SESSION_CLOSED",
      });
    }

    const decision = decide(parsed.data);
    const verified = decision.outcome === "VERIFIED";
    const now = new Date();

    // The decision and the payout permission are written together: payouts must
    // never end up enabled without a verified decision recorded beside them.
    await prisma.$transaction([
      prisma.kycAttempt.update({
        where: { id: attempt.id },
        data: {
          status: verified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED,
          documentType: decision.documentType,
          country: decision.country,
          rejectionReason: verified ? null : decision.rejectionReason,
          completedAt: now,
        },
      }),
      prisma.sellerProfile.update({
        where: { id: attempt.sellerProfileId },
        data: {
          kycStatus: verified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED,
          kycDocType: decision.documentType,
          kycCountry: decision.country,
          kycVerifiedAt: verified ? now : null,
          kycRejectionReason: verified ? null : decision.rejectionReason,
          payoutsEnabled: verified,
        },
      }),
    ]);

    res.json({
      outcome: decision.outcome,
      rejectionReason: verified ? null : decision.rejectionReason,
      payoutsEnabled: verified,
    });
  } catch (err) {
    console.error("POST /seller/verification/:sessionId/submit failed", err);
    res.status(500).json({ error: "Could not complete verification." });
  }
});

/**
 * The payout gate with teeth. There is no money movement to show yet, but the
 * permission boundary is enforced here rather than only in the UI.
 */
sellerVerificationRouter.get("/payouts", async (req, res) => {
  try {
    const profile = await prisma.sellerProfile.findUnique({
      where: { id: req.sellerId },
      select: { payoutsEnabled: true, kycStatus: true },
    });

    if (!profile) {
      return res.status(404).json({ error: "Seller profile not found." });
    }

    if (!profile.payoutsEnabled) {
      return res.status(403).json({
        error: "Verify your identity before you can receive payouts.",
        code: "PAYOUTS_LOCKED",
        kycStatus: profile.kycStatus,
      });
    }

    res.json({
      payouts: {
        enabled: true,
        // Honest empty state. Checkout exists now, but it runs against a payment
        // sandbox and there is no payout pipeline, so the balance is genuinely
        // zero rather than unimplemented-and-hidden.
        balanceCents: 0,
        currency: "USD",
        history: [],
        note: "Payments are sandbox only and payouts aren't built, so there's nothing to pay out.",
      },
    });
  } catch (err) {
    console.error("GET /seller/payouts failed", err);
    res.status(500).json({ error: "Could not load payouts." });
  }
});

import crypto from "crypto";

/**
 * Identity verification provider.
 *
 * WHY THIS IS AN ABSTRACTION, AND WHY THE DEFAULT IS A STUB
 * --------------------------------------------------------
 * Government ID documents must never be stored by this application. They are
 * special-category personal data (GDPR Art. 9-adjacent; India's DPDP Act treats
 * them similarly), and holding ID images or numbers turns our database into a
 * high-value breach target for no product benefit. Real deployments delegate the
 * check to a provider that is built and audited for it, and keep only a
 * reference to the outcome.
 *
 * The shape below deliberately mirrors Stripe Identity so swapping is
 * mechanical:
 *   - startSession()  ~ stripe.identity.verificationSessions.create()
 *                       returns an id and a hosted URL to send the user to
 *   - decide()        ~ the verified / requires_input webhook that follows
 *
 * Other drop-in options: Persona, Onfido, Veriff, Sumsub. If targeting India
 * specifically, DigiLocker is the government route, while Aadhaar eKYC has to
 * go through a licensed aggregator (Signzy, Setu) rather than direct access.
 *
 * Set KYC_PROVIDER=stripe_identity and implement the branch to go live. The
 * stub is the default so development never touches anyone's real documents.
 */

export const KYC_PROVIDER = process.env.KYC_PROVIDER ?? "stub";

export const DOCUMENT_TYPES = ["passport", "drivers_license", "national_id"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type StartedSession = {
  providerSessionId: string;
  /** Where the user completes the check. A real provider hosts this itself. */
  redirectUrl: string;
};

export type Decision =
  | { outcome: "VERIFIED"; documentType: DocumentType; country: string }
  | {
      outcome: "REJECTED";
      documentType: DocumentType;
      country: string;
      rejectionReason: string;
    };

export type DocumentSubmission = {
  documentType: DocumentType;
  country: string;
  /**
   * Passes through memory only. It is never returned in a Decision, never
   * logged, and never written to the database — see the assertion test.
   */
  documentNumber: string;
};

export function startSession(): StartedSession {
  const providerSessionId = `${KYC_PROVIDER}_${crypto.randomBytes(16).toString("hex")}`;

  if (KYC_PROVIDER !== "stub") {
    throw new Error(
      `KYC_PROVIDER="${KYC_PROVIDER}" is not implemented. Add the provider call here.`
    );
  }

  // The stub "hosts" its capture page inside our own frontend.
  return { providerSessionId, redirectUrl: `/seller/verify/${providerSessionId}` };
}

/**
 * Stub decision rules, deliberately deterministic so both branches are testable
 * without anyone's real ID. Mirrors how Stripe and Persona expose fixed test
 * outcomes in their sandboxes.
 *
 *   number ending 0000 -> rejected, document could not be read
 *   number ending 0001 -> rejected, name did not match the account
 *   anything else       -> verified
 */
export function decide(submission: DocumentSubmission): Decision {
  if (KYC_PROVIDER !== "stub") {
    throw new Error(
      `KYC_PROVIDER="${KYC_PROVIDER}" is not implemented. Verify the provider webhook signature here.`
    );
  }

  const { documentType, country, documentNumber } = submission;
  const trimmed = documentNumber.trim();

  if (trimmed.endsWith("0000")) {
    return {
      outcome: "REJECTED",
      documentType,
      country,
      rejectionReason: "The document image couldn't be read clearly.",
    };
  }

  if (trimmed.endsWith("0001")) {
    return {
      outcome: "REJECTED",
      documentType,
      country,
      rejectionReason: "The name on the document didn't match this account.",
    };
  }

  return { outcome: "VERIFIED", documentType, country };
}

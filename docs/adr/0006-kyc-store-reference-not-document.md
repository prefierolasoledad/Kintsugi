# 6. Store a verification reference, never the document

- **Status:** Accepted
- **Recorded:** 2026-08-22

## Context

Sellers receiving money need identity verification. The intuitive
implementation is to ask for a government ID, upload it, and store it for review.

That intuition is the expensive mistake. Storing ID documents means:

- **Regulatory exposure.** Identity documents are special-category personal data
  under GDPR-style regimes, and India's DPDP Act treats them similarly. Holding
  them brings retention limits, deletion obligations, and breach-notification
  duties into scope.
- **A breach target.** A table of passport images is worth far more to an
  attacker than a table of password hashes, and it cannot be rotated after a
  leak. A person cannot change their date of birth.
- **No product benefit.** Nothing in the application needs the document. It
  needs to know *whether the check passed*.

## Decision

Verification is delegated to a provider. We store a **reference to the outcome
and nothing else**.

Persisted:

| Field | Why it is safe |
| --- | --- |
| `kycProvider`, `kycSessionId` | Opaque reference for audit and support |
| `kycStatus` | The decision |
| `kycDocType` | Category (`passport`), not the document |
| `kycCountry` | Issuing country |
| `kycVerifiedAt`, `kycRejectionReason` | When, and why not |

Never persisted: document images, document numbers, dates of birth, addresses.
`documentNumber` is received, passed to `decide()`, and dropped — not logged,
not returned, not written.

`lib/kycProvider.ts` is the only module that touches document data, and it is
shaped after Stripe Identity so replacing the stub is mechanical:
`startSession()` ≈ `verificationSessions.create()`, `decide()` ≈ the webhook
that follows.

`KycAttempt` records each attempt for audit — identity decisions must stay
explainable after the fact — using the same non-sensitive fields.

**The default provider is a deterministic stub**, so development never handles
anyone's real documents. The API reports `isStub: true` and the UI says so on
screen.

## Consequences

- A database compromise leaks provider session ids, not identities.
- Provider swap touches one file.
- Disputes require the provider's dashboard; we cannot re-examine a document
  ourselves. Correct — re-examining would mean having kept it.
- The stub verifies nobody. Acceptable only because it is labelled everywhere it
  surfaces; a stub that silently looks real is worse than no stub.
- Verified by test: after submitting a document number, the profile and attempt
  rows are dumped and asserted not to contain it.

## Alternatives considered

**Upload and store ID images for manual review.** Maximum control, maximum
liability. Requires encryption at rest, access logging, retention policies, and
a review team — and turns the database into the highest-value target in the
system.

**Store a hash of the document number.** Sounds safer than plaintext, but ID
number spaces are small and structured enough to be brute-forced, so a hash is
closer to plaintext than to a secret. And nothing needs it.

**Skip verification entirely.** Viable until money moves. Fraud and money
laundering controls are why marketplaces verify sellers, and retrofitting
verification onto sellers who already have balances is worse than building it
first.

**Direct Aadhaar eKYC.** Requires being a licensed entity or going through an
aggregator (Signzy, Setu). Not available to a solo project; DigiLocker is the
open government route if targeting India.

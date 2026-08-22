# Security Policy

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository (Security → Report a vulnerability), which keeps the report
private until a fix exists.

Useful to include: what you did, what happened, and what you expected — plus
the affected endpoint or file if you know it.

This is a personal project with no SLA. Expect a response in days rather than
hours.

## Scope

Kintsugi is **in development and not deployed**. There is no production
instance, no real user data, and no real money. Reports are welcome anyway —
the point of the exercise is getting this right — but nothing here is protecting
live users today.

Three integrations are deliberate stubs and are **not** vulnerabilities:

| Stub | Behaviour |
| --- | --- |
| Email (`lib/mailer.ts`) | Verification links print to the server console |
| Identity (`lib/kycProvider.ts`) | Deterministic fake; verifies nobody |
| Storage (`lib/storage.ts`) | Local disk, publicly readable by design |

The identity stub reports `isStub: true` through the API and is labelled on
screen, so it never implies a real check occurred.

## Posture

What is deliberately in place, with the reasoning in each linked record:

**Sessions.** 15-minute JWT access tokens plus 30-day opaque refresh tokens.
Refresh tokens are stored as SHA-256 hashes, rotate on every use, and reuse of a
rotated token revokes the whole family — theft is detected, not merely survived.
All cookies are `httpOnly`, `sameSite=lax`, `secure` in production, so XSS
cannot read a session.
→ [ADR 0001](docs/adr/0001-access-and-refresh-tokens.md)

**Passwords.** bcrypt cost 12. Minimum 12 characters with no composition rules,
plus rejection of anything in known breach corpora via Pwned Passwords
k-anonymity — only a 5-character hash prefix leaves the server.
→ [ADR 0004](docs/adr/0004-password-policy.md)

**Authorisation.** `requireAuth` establishes identity; `requireSeller` resolves
the caller's seller profile. Every seller query is scoped by `sellerId`, and
records owned by others return 404 rather than 403 so response codes don't
disclose existence.

**Uploads.** Magic-byte validation (not extension or `Content-Type`),
re-encoding through Sharp that strips EXIF including GPS, an 8 MB cap, a
50-megapixel decode cap against decompression bombs, and server-generated
storage keys validated against a strict pattern so user input never reaches a
filesystem path.
→ [ADR 0010](docs/adr/0010-strip-image-metadata.md)

**Identity data.** No ID images, document numbers, or dates of birth are ever
stored. Only a provider session reference, document type, country, outcome, and
timestamp.
→ [ADR 0006](docs/adr/0006-kyc-store-reference-not-document.md)

**SQL injection.** All database access goes through Prisma's query builder,
which parameterises. There is no raw SQL in the codebase; `$queryRaw` with
interpolation would reintroduce the risk.

**Boundaries.** The browser never reaches Express directly. The BFF forwards
without interpreting and is therefore *not* a security control — every rule is
enforced in the API, and disabled UI is always re-checked server-side.
→ [ADR 0002](docs/adr/0002-bff-proxy.md)

## Known gaps

Tracked, not hidden:

- **Rate limiting is in-process.** Correct for a single instance; replicas would
  each get their own allowance. Needs Redis before scaling out. Currently
  applied to uploads (30/hr) and verification attempts (5/hr) — not to
  login, which should have it.
- **No CSRF tokens.** `sameSite=lax` cookies plus a same-origin BFF cover the
  common cases, but state-changing requests have no additional token. Worth
  adding before deployment.
- **No security headers.** No CSP, HSTS, or `X-Content-Type-Options`. `helmet`
  and a CSP belong here before this is public.
- **No account lockout or login throttling.** Password guessing is currently
  unbounded.
- **Email enumeration is partially possible.** Resend-verification is
  deliberately silent, but signup distinguishes an already-verified address.
- **Uploads are served from a public path** with unguessable keys. Adequate for
  listing photos; not appropriate for anything private.
- **No automated security testing.** No dependency scanning, SAST, or
  `npm audit` in CI — there is no CI.
- **No secret management.** Secrets come from `.env` files. `JWT_SECRET`
  defaults to a placeholder that must be replaced.

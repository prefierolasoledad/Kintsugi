# 1. Access + rotating refresh tokens with reuse detection

- **Status:** Accepted
- **Recorded:** 2026-08-22

## Context

Sessions need to survive a browser restart for weeks, while a stolen credential
should stop working quickly. Those two goals pull in opposite directions with a
single long-lived token.

A JWT is cheap to validate — no database round trip — but cannot be revoked
before it expires. A long-lived JWT is therefore a credential you cannot take
back.

## Decision

Two tokens with different jobs.

**Access token** — signed JWT, 15 minutes, `httpOnly` cookie. Validated
statelessly on every request.

**Refresh token** — opaque random string, 30 days, `httpOnly` cookie. Only the
**SHA-256 hash** is stored. Each use rotates it: a new token is issued and the
old row records `replacedByTokenHash`.

**Reuse detection:** presenting an already-rotated token means two parties hold
it. There is no way to tell which is the attacker, so the entire token family is
revoked. The legitimate user logs in again; the stolen token is worthless.

Refresh tokens are hashed for the same reason passwords are — a refresh token is
sufficient to impersonate someone, so a database leak must not yield usable
sessions.

## Consequences

- Revocation works within 15 minutes without a database lookup per request.
- Token theft is detected rather than merely survived.
- Requires a `refresh_tokens` table and rotation logic.
- Legitimate users can be logged out by a race where two tabs refresh
  simultaneously. Accepted: rare, and the failure mode is a re-login rather
  than a compromise.
- The BFF must transparently refresh on 401 and retry, or every session would
  visibly break every 15 minutes ([ADR 0002](0002-bff-proxy.md)).

## Alternatives considered

**Single long-lived JWT.** Simplest, and unrevocable. A leaked token stays valid
until expiry.

**Server-side sessions in Redis.** Trivially revocable, but adds infrastructure
and a lookup on every request. Reasonable, but the JWT + refresh pairing gets
most of the benefit without another service to run.

**Refresh tokens stored in plaintext.** Simpler comparison, but converts a
read-only database leak directly into account takeover.

**Rotation without reuse detection.** Rotation alone narrows the window; it does
not notice that a token leaked. Detection is the part that turns theft into a
dead end, and it costs one extra column.

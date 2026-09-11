# 34. Paid homepage placement, recorded as an agreement and labelled as an ad

- **Status:** Accepted — not yet implemented. See
  [plan 0005](../plans/0005-placement-and-messaging.md).
- **Recorded:** 2026-09-11

## Context

`Listing.featured` has existed since the catalogue was built, with this comment
on it:

> Merchandising flag for the "Picked for you" shelf. This is hand-curation, not
> personalisation — there is no recommendation engine behind it, and naming it
> `featured` keeps that honest at the data layer.

Nothing writes it. There is no admin surface for curation at all, and the
homepage derives its four shelves instead: `discounted` from
`originalPriceCents > priceCents`, `topRated` from listings that actually have
reviews, `newArrivals` from creation order. Each shelf earns its contents, and
`page.tsx` says why — *"Derived rather than flagged: a higher original price
means it genuinely is reduced, so nothing here claims a discount that doesn't
exist."*

So the gap is not a missing column. It is that a moderator cannot choose
anything, and a seller cannot ask to be chosen.

## Decision

### Placement is an AGREEMENT, and no card is charged

`PlacementRequest` records what was asked, what was countered, what was finally
agreed, and for which period. Money is settled outside the application.

**Rejected: charging the seller through Stripe.** Today money moves in exactly
two directions — buyer to platform ([ADR 0013](0013-payment-claim-then-charge.md))
and platform to seller ([ADR 0029](0029-payouts-separate-transfers-not-destination-charges.md)).
A seller-to-platform charge is a third, and it is not a small one: it needs its
own claim-then-charge guard, its own idempotency key, an invoice, tax treatment,
and a refund path for the case where placement was paid for and not delivered.
Every one of those is a money-safety surface, and none of them teaches anything
the first two did not already demonstrate.

**Rejected: netting the fee off the seller's next payout.** Tempting, because
`PayoutDebt` already nets a balance the platform is owed
([ADR 0030](0030-payout-eligibility-and-hold.md)). Declined because that ledger
exists for one specific reason — a refund that could not be clawed back from a
transfer — and it is read by the payout eligibility query. Putting advertising
fees into it means the answer to "why is this seller's payout short" stops being
"a refund was reversed" and becomes "something in a merchandising table".
Coupling merchandising to the payout ledger is how a finance view becomes
unauditable.

The consequence is stated rather than hidden: **this repository can negotiate a
placement fee and cannot collect one.** That is a deliberate boundary, and it is
the honest line in the "what is not built" list.

### Slots are typed, and the live one is claimed by a partial unique index

```
HERO          one at a time — the banner at the top of the homepage
PICKED_SHELF  four positions — the "Picked for you" shelf
```

Two listings must never hold the same live slot and position. The guard is the
same discipline as every other in the codebase
([ADR 0012](0012-row-locking-for-stock.md),
[ADR 0013](0013-payment-claim-then-charge.md)): a claim whose success *is* the
permission to proceed. Here it is a **partial unique index**, created in a
hand-edited migration because Prisma cannot express one:

```sql
CREATE UNIQUE INDEX placement_live_slot
  ON placement_requests (slot, position)
  WHERE status = 'LIVE';
```

Going live is therefore an `UPDATE … SET status = 'LIVE' WHERE status =
'AGREED'`, and two moderators activating two agreements for the hero at the same
instant produce one success and one unique-violation, not two heroes.

**Rejected: a `featured` boolean plus an `ORDER BY`.** The existing flag cannot
express a period, a slot, or an ordering, and it cannot be claimed — two admins
setting `featured = true` both succeed, which is how a hero banner ends up
non-deterministic. `Listing.featured` stays for unpaid editorial curation and
keeps its honest comment; paid placement is a different table because it is a
different thing.

**Rejected: overlapping-period uniqueness.** A constraint over date ranges
(`EXCLUDE USING gist`) would let two agreements be booked for non-overlapping
future weeks. It is the better model and it is more machinery than a homepage
with two slots needs; a booked-out future calendar is not a problem this has.

### A paid placement is visibly labelled, always

Anything on the homepage because somebody agreed to pay for it renders a
**"Promoted"** label. Not a tooltip, not a footnote — a label on the card and on
the hero.

This is not a preference. Undisclosed paid placement presented as editorial
selection is deceptive advertising and is regulated in most markets the site
could plausibly operate in. It would also contradict the one property this
repository has consistently spent effort to keep: that the site does not claim
things which are not true. A shelf whose comment says *"nothing here claims a
discount that doesn't exist"* cannot sit above a banner that hides who paid for
it.

### Paid slots cannot enter the derived shelves

`HERO` and `PICKED_SHELF` only. Price Drops, Best Rated and New Arrivals stay
derived from the data.

**Rejected: letting an admin place a listing on any shelf.** The derived shelves
are the honest ones — a listing appears in Price Drops because it *is* reduced,
and in Best Rated because it *has* good reviews. An admin-inserted row on either
breaks the only guarantee those shelves offer, and it does it silently, because
a card placed in Price Drops looks exactly like a card that earned its way
there.

### A sold listing leaves the homepage immediately

The homepage query filters `status = 'ACTIVE'`, so a promoted listing that sells
stops rendering the moment it does, with the agreement still recorded as `LIVE`
until its period ends.

No pro-rata anything, which is only tenable because no money was taken. If the
charge ever gets built, this is the case that will need a policy first.

## Consequences

**A second notification event type**, `PLACEMENT_DECIDED`, bringing the
catalogue from twelve to thirteen alongside ADR 0033's.

**The admin panel gains a merchandising surface**, which is a new category of
admin power: every existing one is *restrictive* — remove a listing, suspend an
account, refuse a return. Choosing what to promote is the first one that is
*productive*, and the moderation log needs to record it with the same weight.

**`Listing.featured` remains unwritten by any route.** Editorial curation is
now expressible through the admin surface as an unpaid placement; the boolean
stays for the seed data that uses it and is a candidate for removal once the
placement table is real.

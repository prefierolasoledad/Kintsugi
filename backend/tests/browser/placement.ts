import { WEB, prisma, requireServices } from "../lib/db";
import { PASSWORD, Scope } from "../lib/fixtures";
import { fillReliably, login, openBrowser, realFailures } from "../lib/browser";
import { currentCode, freshCode } from "../lib/totp";
import { cleanupOnInterrupt, main, wireInterrupt } from "../lib/harness";
import { Condition, ListingStatus, UserRole } from "../../src/generated/prisma/enums";

/**
 * A placement negotiated from one end to the other, in a browser.
 *
 * WHAT THIS PROVES THAT THE ROUTE SUITE DOES NOT
 * `placement-routes.ts` drives the same negotiation over HTTP and proves the
 * endpoints and the authorisation. It cannot prove that a seller can FIND any
 * of it, that the counter-offer is legible when it arrives, or that the terms
 * shown on screen are the terms in the database. A feature nobody can reach is
 * indistinguishable from a feature that does not exist.
 *
 * The sequence is deliberately the real one, with two logged-in parties:
 *   seller asks  →  moderator counters  →  seller accepts  →  moderator
 *   activates  →  the label appears on the homepage.
 */

const scope = new Scope("uiplace");
wireInterrupt();
cleanupOnInterrupt(() => scope.cleanup());

const TITLE = `Gilded hall bench ${Date.now().toString().slice(-6)}`;

void main(
  "placement negotiation (browser)",
  async (t) => {
    await requireServices({ api: true, web: true });

    const sellerEmail = await scope.register("seller", { seller: true });
    const adminEmail = await scope.register("admin");

    const profile = await prisma.sellerProfile.findFirstOrThrow({
      where: { user: { email: sellerEmail } },
      select: { id: true },
    });
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

    const slug = `uiplace-${Date.now()}`;
    const listing = await prisma.listing.create({
      data: {
        slug,
        title: TITLE,
        description: "A long bench, repaired at one end with a visible gold seam.",
        sellerId: profile.id,
        categoryId: category.id,
        condition: Condition.GOOD,
        priceCents: 32_000,
        quantity: 1,
        status: ListingStatus.ACTIVE,
      },
      select: { id: true },
    });
    await scope.trackListing(listing.id);

    await prisma.user.update({
      where: { email: adminEmail },
      data: { role: UserRole.ADMIN },
    });

    /**
     * Warm the new routes before the browser asks for them.
     *
     * Against a dev server the first request to a route compiles it, which took
     * ~60s here and blew through Playwright's 30s navigation timeout on a page
     * that works perfectly once built. Warming is not papering over a slow
     * page: it removes a one-off compile from the middle of a user journey the
     * suite is trying to time.
     */
    for (const path of ["/seller/placements", "/seller/messages", "/admin/placements", "/admin/messages"]) {
      await fetch(`${WEB}${path}`, { signal: AbortSignal.timeout(180_000) }).catch(() => {});
    }

    const h = await openBrowser("uiplace");

    try {
      /* ---- 1. the seller finds it and asks ---- */
      /** Named for `realFailures`, which exempts exactly this phase: the auth
       *  probe 401s before anybody is signed in, and that is the correct
       *  answer rather than a fault. */
      h.phase("pre-login");
      await login(h.page, sellerEmail);
      h.phase("seller asks");

      await h.page.goto(`${WEB}/seller`, { waitUntil: "networkidle" });
      const hubLink = h.page.locator('a[href="/seller/placements"]');
      t.check(
        (await hubLink.count()) > 0,
        "the seller hub links to homepage placement — it is discoverable"
      );

      await hubLink.first().click();
      await h.page.waitForURL(/\/seller\/placements/, { timeout: 20000 });
      await h.page.waitForTimeout(1200);

      /**
       * THE DISCLOSURE, ON SCREEN, BEFORE THE FORM.
       * This is the legal requirement rather than a product preference, and the
       * page gets the wording from the API so it cannot be rendered without it.
       */
      const disclosure = await h.page.locator("main").innerText();
      t.check(
        /promoted/i.test(disclosure),
        "the request page tells the seller placements are labelled Promoted",
        disclosure.slice(0, 160)
      );

      await h.page.selectOption('select >> nth=0', { label: TITLE });
      await h.page.selectOption('select >> nth=1', "HERO");
      await fillReliably(h.page, 'input[type="number"]', "40");
      await fillReliably(
        h.page,
        "textarea",
        "It is the nicest thing in my shop and it photographs beautifully."
      );
      await h.page.click('button:has-text("Send request")');
      await h.page.waitForTimeout(2500);

      const afterAsk = await h.page.locator("main").innerText();
      t.check(
        afterAsk.includes(TITLE) && /Waiting for Kintsugi/.test(afterAsk),
        "the request appears, and says whose turn it is in words",
        afterAsk.slice(0, 240)
      );

      /* ---- 2. the moderator counters ---- */
      h.phase("pre-login");
      await h.page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
      await h.page.evaluate(() => localStorage.clear());
      await login(h.page, adminEmail);
      h.phase("moderator counters");

      // Enrol and step up the way a person does; two codes from two periods.
      const setup = await h.page.evaluate(
        async (password) => {
          const res = await fetch("/api/admin/totp/setup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          return res.json();
        },
        PASSWORD
      );
      const secret = (setup as { secret: string }).secret;
      await h.page.evaluate(
        async (code) => {
          await fetch("/api/admin/totp/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
        },
        currentCode(secret)
      );
      await h.page.evaluate(
        async ([password, code]) => {
          await fetch("/api/admin/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password, code }),
          });
        },
        [PASSWORD, await freshCode(secret)]
      );

      await h.page.goto(`${WEB}/admin/placements`, { waitUntil: "networkidle" });
      await h.page.waitForTimeout(2000);

      const queue = await h.page.locator("main").innerText();
      t.check(
        queue.includes(TITLE),
        "the moderator's placement queue shows the request",
        queue.slice(0, 240)
      );
      t.check(
        /Live on the homepage/.test(queue),
        "and the screen opens with what is already live, not with the next decision"
      );

      await h.page.click('button:has-text("Counter or decline")');
      await h.page.waitForTimeout(500);
      await fillReliably(h.page, 'input[type="number"]', "60");
      await fillReliably(
        h.page,
        "textarea",
        "The hero is our most valuable slot, so sixty dollars for the week."
      );
      await h.page.click('button:has-text("Send counter-offer")');
      await h.page.waitForTimeout(2500);

      const countered = await h.page.locator("main").innerText();
      t.check(
        /COUNTERED/.test(countered),
        "the request moves to COUNTERED on screen",
        countered.slice(0, 240)
      );

      /* ---- 3. the seller reads the counter and accepts ---- */
      h.phase("pre-login");
      await h.page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
      await login(h.page, sellerEmail);
      h.phase("seller accepts");
      await h.page.goto(`${WEB}/seller/placements`, { waitUntil: "networkidle" });
      await h.page.waitForTimeout(1800);

      const counterSeen = await h.page.locator("main").innerText();
      t.check(
        /Your turn/.test(counterSeen) && /\$60/.test(counterSeen),
        "the seller sees the counter-offer and the number in it",
        counterSeen.slice(0, 300)
      );

      await h.page.click('button:has-text("Accept these terms")');
      await h.page.waitForTimeout(2500);

      const agreed = await h.page.locator("main").innerText();
      t.check(
        /Agreed, not live yet/.test(agreed),
        "accepting reaches an agreed state the seller can read",
        agreed.slice(0, 240)
      );

      /* ---- 4. the conversation is legible to the seller ---- */
      h.phase("seller reads the thread");
      await h.page.goto(`${WEB}/seller/messages`, { waitUntil: "networkidle" });
      await h.page.waitForTimeout(1500);
      await h.page.click(`button:has-text("Homepage placement")`);
      await h.page.waitForTimeout(1200);

      const thread = await h.page.locator("main").innerText();
      t.check(
        /most valuable slot/.test(thread),
        "the moderator's actual words are in the thread, not just a status",
        thread.slice(0, 300)
      );

      /* ---- 5. the moderator makes it live, and the homepage says so ---- */
      h.phase("pre-login");
      await h.page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
      await login(h.page, adminEmail);
      h.phase("moderator activates");
      await h.page.goto(`${WEB}/admin/placements`, { waitUntil: "networkidle" });
      await h.page.waitForTimeout(2000);
      await h.page.click('button:has-text("Make it live")');
      await h.page.waitForTimeout(2500);

      const live = await h.page.locator("main").innerText();
      /**
       * NOT a search for "LIVE" in the queue. Activating moves the row out of
       * the "Needs you" tab on purpose — it no longer needs anybody. What
       * proves it worked is the live-slots card at the top of the screen, which
       * is why that card is the first thing on the page.
       */
      t.check(
        /live on the homepage/i.test(live) && live.includes(slug),
        "the live-slots card now names this listing",
        live.slice(0, 220)
      );

      h.phase("homepage");
      await h.page.goto(`${WEB}/`, { waitUntil: "networkidle" });
      await h.page.waitForTimeout(1500);

      const home = await h.page.locator("main").innerText();
      t.check(home.includes(TITLE), "the promoted listing is on the homepage", home.slice(0, 200));
      /**
       * Case-insensitive, and that is not laziness. `innerText` returns the
       * RENDERED text, and both labels are `uppercase` in CSS, so the browser
       * reports "PROMOTED" while the source says "Promoted". A case-sensitive
       * match failed here against a page that was labelled correctly.
       */
      t.check(
        /promoted/i.test(home),
        "and it is labelled Promoted where a visitor reads it",
        home.slice(0, 200)
      );

      await h.shot("negotiated", { fullPage: false });

      /* ---- 6. nothing broke on the way ---- */
      t.check(h.jsErrors.length === 0, "no JavaScript errors", h.jsErrors.slice(0, 3).join(" | "));
      const bad = realFailures(h.badResponses);
      t.check(bad.length === 0, "no failed requests", bad.slice(0, 4).join(" | "));
    } finally {
      await h.close();
    }
  },

  async (t) => {
    await prisma.placementRequest.deleteMany({ where: { listing: { title: TITLE } } });
    await scope.cleanup();
    await scope.verifyClean(t);
  }
);

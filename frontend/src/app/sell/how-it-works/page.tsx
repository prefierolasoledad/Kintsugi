import InfoPage from "@/components/InfoPage";

export default function HowItWorksPage() {
  return (
    <InfoPage
      eyebrow="Selling"
      title="How selling works"
      intro="The short version: list it, someone finds it, you get paid. Here's the longer version, step by step."
    >
      <h2>1. List it</h2>
      <p>
        Take a few photos in decent light — one wide shot, one or two close-ups of
        any wear or damage. Write a plain description: what it is, roughly how old
        it is if you know, and its actual condition. Flaws go in the listing, not
        left for the buyer to discover.
      </p>

      <h2>2. It gets found</h2>
      <p>
        Your listing shows up under the category it belongs to, so the people
        looking specifically for a mid-century chair or a working record player
        actually see it — not just whoever happens to scroll past.
      </p>

      <h2>3. It sells</h2>
      <p>
        When someone buys it, you get a prepaid shipping label to print — see{" "}
        <a href="/sell/shipping-labels" className="text-gold-dim underline">
          shipping labels
        </a>{" "}
        for how that works. Pack it reasonably well and drop it off.
      </p>

      <h2>4. You get paid</h2>
      <p>
        The buyer pays Kintsugi, not you. Once they confirm the item arrived and
        the seven-day return window closes, the money is yours to take — you ask
        for it whenever you like rather than waiting for a payout day. See{" "}
        <a href="/sell/payouts" className="text-gold-dim underline">
          payouts
        </a>{" "}
        for timing, and{" "}
        <a href="/sell/seller-fees" className="text-gold-dim underline">
          seller fees
        </a>{" "}
        for what we charge, which is nothing.
      </p>
    </InfoPage>
  );
}

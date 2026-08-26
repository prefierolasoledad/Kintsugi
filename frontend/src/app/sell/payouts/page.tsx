import InfoPage from "@/components/InfoPage";

export default function PayoutsPage() {
  return (
    <InfoPage
      eyebrow="Selling"
      title="Payouts"
      intro="Your money is held briefly, not indefinitely — here's the actual timeline."
    >
      <h2>Why payment is held</h2>
      <p>
        When an item sells, the buyer&apos;s payment is held rather than sent to you
        immediately. This protects both sides: the buyer isn&apos;t paying into the
        void, and you&apos;re not shipping something on a promise.
      </p>

      <h2>When you actually get paid</h2>
      <p>
        Funds are released to you as soon as one of these happens:
      </p>
      <ul>
        <li>The buyer confirms the item arrived as described, or</li>
        <li>
          Three days pass after tracking shows delivery, with no return request
          opened.
        </li>
      </ul>

      <h2>How you get paid</h2>
      <p>
        Payouts go to the bank account you connect in your seller settings.
        There&apos;s no minimum payout threshold — even a single sale gets paid out
        on its own, not batched with future sales.
      </p>

      <h2>If a return is opened</h2>
      <p>
        Payout is paused until the return is resolved. See{" "}
        <a href="/help/returns-refunds" className="text-gold-dim underline">
          returns &amp; refunds
        </a>{" "}
        for how that process works.
      </p>
    </InfoPage>
  );
}

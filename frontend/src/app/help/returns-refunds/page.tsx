import InfoPage from "@/components/InfoPage";

export default function ReturnsRefundsPage() {
  return (
    <InfoPage
      eyebrow="Help"
      title="Returns & refunds"
      intro="Every purchase includes a 14-day return window if it doesn't match the listing."
    >
      <h2>What qualifies</h2>
      <p>
        If an item arrives significantly different from its listing — undisclosed
        damage, wrong item, not-as-described condition — you can return it within
        14 days of delivery for a full refund, including original shipping.
      </p>
      <p>
        Changed your mind and the item was accurately listed? Returns are still
        accepted within the same window, but return shipping is on you.
      </p>

      <h2>How to start one</h2>
      <p>
        Open the order from your account, select &quot;Start a return,&quot; and
        say what&apos;s wrong. You&apos;ll get a prepaid return label if the item
        wasn&apos;t as described.
      </p>

      <h2>Refund timing</h2>
      <p>
        Refunds are issued once the returned item is scanned back in transit —
        you don&apos;t need to wait for it to physically arrive back at the
        seller. Funds typically land back on your original payment method within
        5–7 business days after that.
      </p>
    </InfoPage>
  );
}

import InfoPage from "@/components/InfoPage";

export default function SellerFeesPage() {
  return (
    <InfoPage
      eyebrow="Selling"
      title="Seller fees"
      intro="No listing fee, no monthly charge. We only take a cut when your item actually sells."
    >
      <h2>What&apos;s deducted at sale</h2>
      <ul>
        <li>
          <strong>8% marketplace commission</strong> — covers hosting your listing,
          getting it in front of buyers, and payment protection.
        </li>
        <li>
          <strong>Payment processing: 2.9% + $0.30</strong> — this goes straight to
          the payment processor, not to us.
        </li>
      </ul>

      <h2>Example</h2>
      <p>
        Sell something for $100: $8 marketplace commission, $3.20 payment
        processing, and you receive <strong>$88.80</strong>. The final breakdown
        is always shown before you confirm a sale — no surprise deductions after
        the fact.
      </p>

      <h2>What&apos;s free</h2>
      <p>
        Listing an item costs nothing, whether it sells or not. Relisting an
        expired listing is also free.
      </p>
    </InfoPage>
  );
}

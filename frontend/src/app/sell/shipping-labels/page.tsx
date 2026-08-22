import InfoPage from "@/components/InfoPage";

export default function ShippingLabelsPage() {
  return (
    <InfoPage
      eyebrow="Selling"
      title="Shipping labels"
      intro="Once an item sells, you're not the one figuring out postage."
    >
      <h2>How it works</h2>
      <p>
        As soon as a buyer pays, a prepaid shipping label is generated for that
        order — sized and priced against the weight and dimensions you gave when
        you listed the item. You print it, tape it to the box, and drop it off.
      </p>

      <h2>Packing it</h2>
      <p>
        You're responsible for packing the item well enough to survive transit.
        For anything fragile — ceramics, glass, framed items — that means real
        padding, not a single layer of newspaper. Damage from bad packing isn't
        covered.
      </p>

      <h2>Tracking</h2>
      <p>
        Once the label is scanned at drop-off, tracking updates automatically on
        both your order page and the buyer's — you don't need to enter anything
        manually.
      </p>

      <h2>No label printer?</h2>
      <p>
        Most shipping carriers will print a label for you at a staffed location
        if you show them the QR code from your order page.
      </p>
    </InfoPage>
  );
}

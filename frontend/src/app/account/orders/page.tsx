"use client";

import AccountPlaceholder from "@/components/AccountPlaceholder";
import { OrdersIcon } from "@/components/AccountIcons";

export default function MyOrdersPage() {
  return (
    <AccountPlaceholder
      title="My orders"
      lead="Every purchase you make will appear here, with its status and what you paid."
      because="Checkout isn't built yet, so no orders exist to show. Items you hold in your cart are listed there instead."
      icon={<OrdersIcon />}
    />
  );
}

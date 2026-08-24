"use client";

import AccountPlaceholder from "@/components/AccountPlaceholder";
import { CancelIcon } from "@/components/AccountIcons";

export default function MyCancellationsPage() {
  return (
    <AccountPlaceholder
      title="My cancellations"
      lead="Orders you cancel, and refunds owed against them, will be tracked here."
      because="There are no orders to cancel yet — cancellations depend on checkout, which isn't built. Releasing a held item from your cart isn't a cancellation and needs no record."
      icon={<CancelIcon />}
    />
  );
}

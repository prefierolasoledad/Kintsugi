"use client";

import AccountPlaceholder from "@/components/AccountPlaceholder";
import { CancelIcon } from "@/components/AccountIcons";

export default function MyCancellationsPage() {
  return (
    <AccountPlaceholder
      title="My cancellations"
      lead="Orders you cancel, and refunds owed against them, will be tracked here."
      because="Cancelled and failed orders show up in My orders with their status. A separate view here — with refunds and reasons — isn't built, because refunds aren't either."
      icon={<CancelIcon />}
    />
  );
}

import Link from "next/link";

/** Black promo strip above the header, as in the reference design. */
export default function TopBar() {
  return (
    <div className="bg-ink px-6 py-2.5 text-paper">
      <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-6 text-sm">
        <p className="text-center text-paper/90">
          Everything here is secondhand and honestly described —{" "}
          <Link href="/search" className="font-semibold text-paper underline">
            Shop Now
          </Link>
        </p>
      </div>
    </div>
  );
}

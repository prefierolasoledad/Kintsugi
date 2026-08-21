import Logo from "@/components/Logo";

export default function Footer() {
  return (
    <footer className="border-t border-line px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-ink-dim sm:flex-row">
        <span className="flex items-center gap-2">
          <Logo size={20} />
          金継ぎ Kintsugi — repaired, not hidden.
        </span>
        <span className="text-xs text-ink-dim/70">
          Marketplace imagery via Unsplash.
        </span>
      </div>
    </footer>
  );
}

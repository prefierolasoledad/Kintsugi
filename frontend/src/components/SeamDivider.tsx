export default function SeamDivider() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6" aria-hidden="true">
      <svg
        viewBox="0 0 800 24"
        preserveAspectRatio="none"
        className="h-6 w-full"
      >
        <path
          d="M0 12 L120 12 L140 4 L165 20 L190 10 L400 14 L420 2 L445 22 L470 12 L800 12"
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </svg>
    </div>
  );
}

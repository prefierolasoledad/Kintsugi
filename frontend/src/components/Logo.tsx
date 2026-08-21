export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="kintsugi-disc">
          <circle cx="20" cy="20" r="17" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="17" fill="#14120f" />
      <g clipPath="url(#kintsugi-disc)">
        <path
          d="M1 11 L14 16 L10 21 L20 19 L17 27 L27 22 L24 30 L39 25"
          stroke="#f0c869"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <circle cx="20" cy="20" r="17" stroke="#caa04a" strokeWidth="1.5" />
    </svg>
  );
}

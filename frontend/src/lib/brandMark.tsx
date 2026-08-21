const SEGMENTS = [
  { left: -0.05, top: 0.33, width: 0.62, height: 0.035, rotate: 13 },
  { left: 0.32, top: 0.46, width: 0.42, height: 0.035, rotate: -22 },
  { left: 0.6, top: 0.56, width: 0.62, height: 0.035, rotate: 9 },
];

export function CrackDisc({
  size,
  borderWidth,
  background = "#14120f",
  border = "#caa04a",
  crackColor = "#f0c869",
}: {
  size: number;
  borderWidth: number;
  background?: string;
  border?: string;
  crackColor?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background,
        border: `${borderWidth}px solid ${border}`,
        position: "relative",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {SEGMENTS.map((seg, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: seg.left * size,
            top: seg.top * size,
            width: seg.width * size,
            height: Math.max(seg.height * size, 3),
            background: crackColor,
            transform: `rotate(${seg.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

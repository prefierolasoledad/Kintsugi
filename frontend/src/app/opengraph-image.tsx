import { ImageResponse } from "next/og";
import { CrackDisc } from "@/lib/brandMark";

export const alt = "Kintsugi — Beautifully Secondhand";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0908",
        }}
      >
        <CrackDisc size={140} borderWidth={5} />

        <div
          style={{
            marginTop: 36,
            fontSize: 72,
            fontWeight: 600,
            color: "#f3ede2",
            letterSpacing: -1,
            display: "flex",
          }}
        >
          Kintsugi
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            color: "#b8ae9c",
            display: "flex",
          }}
        >
          Beautifully secondhand.
        </div>
      </div>
    ),
    { ...size }
  );
}

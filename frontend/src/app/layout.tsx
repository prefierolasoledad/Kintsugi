import type { Metadata } from "next";
import { Geist_Mono, Nunito, Quicksand } from "next/font/google";
import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kintsugi — Beautifully Secondhand",
  description:
    "A marketplace for pre-loved furniture, clothing, and objects — chosen for character, not condition. Buy something with a story, or sell the one taking up space in your closet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} ${geistMono.variable} ${quicksand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

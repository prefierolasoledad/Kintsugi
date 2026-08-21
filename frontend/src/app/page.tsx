import Categories from "@/components/Categories";
import Footer from "@/components/Footer";
import Hero from "@/components/Hero";
import HowItWorks from "@/components/HowItWorks";
import Nav from "@/components/Nav";
import Philosophy from "@/components/Philosophy";
import RecentlyListed from "@/components/RecentlyListed";
import SeamDivider from "@/components/SeamDivider";
import TrustStrip from "@/components/TrustStrip";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <RecentlyListed />
        <TrustStrip />
        <Categories />
        <SeamDivider />
        <Philosophy />
        <SeamDivider />
        <HowItWorks />
      </main>
      <Footer />
    </>
  );
}

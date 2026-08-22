import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    /**
     * Next blocks optimizing images from private IPs as SSRF protection, which
     * catches the dev backend on localhost:4000. Relaxed in development only —
     * in production uploads are served from object storage on a public
     * hostname, so this stays off where it would actually matter.
     */
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      // Seller-uploaded photos, served by the backend in development. In
      // production these come off a CDN/object store instead.
      {
        protocol: "http",
        hostname: "localhost",
        port: "4000",
        pathname: "/uploads/**",
      },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Steam avatar CDN images
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.steamstatic.com" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
    ],
  },
  // Allow leaflet's CJS build to be bundled
  transpilePackages: ["leaflet"],
};

export default nextConfig;

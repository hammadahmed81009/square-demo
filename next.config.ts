import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    taint: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "images.squareup.com",
        pathname: "/**",
        protocol: "https",
      },
      {
        hostname: "square-catalog-sandbox.s3.amazonaws.com",
        pathname: "/**",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;

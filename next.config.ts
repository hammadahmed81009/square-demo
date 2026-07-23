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
      {
        hostname: "items-images-sandbox.s3.us-west-2.amazonaws.com",
        pathname: "/**",
        protocol: "https",
      },
      {
        hostname: "items-images-production.s3.us-west-2.amazonaws.com",
        pathname: "/**",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;

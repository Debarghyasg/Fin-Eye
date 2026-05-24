/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // Turbopack is the default dev bundler in Next.js 15 — no flag needed
  // experimental.turbo is removed; use next dev --turbopack if you want it explicitly
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output produces a slim, self-contained server bundle at
  // .next/standalone/. The Dockerfile copies that into the runtime image
  // instead of dragging the full node_modules tree, keeping the final
  // image around ~180 MB.
  output: "standalone",
  experimental: {
    // Prisma must be loaded as a regular CJS require at runtime — Next's
    // bundler can't handle its native query engine binaries. Marking it
    // external means server.js requires @prisma/client from node_modules,
    // which the Docker runtime stage provides intact.
    serverComponentsExternalPackages: ["@prisma/client", "prisma"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cards.scryfall.io" },
      { protocol: "https", hostname: "c1.scryfall.com" },
      { protocol: "https", hostname: "c2.scryfall.com" },
    ],
  },
};

export default nextConfig;

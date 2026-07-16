import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds (BUILD_DIR=.next-verify npm run build) must not clobber
  // the .next dir a running `next dev` owns — that corrupts its Turbopack state.
  distDir: process.env.BUILD_DIR || ".next",
  experimental: {
    // Client router cache: revisiting a page inside these windows is instant
    // (served from cache, refreshed after mutations via revalidatePath).
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
};

export default nextConfig;

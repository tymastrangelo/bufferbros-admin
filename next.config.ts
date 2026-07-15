import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

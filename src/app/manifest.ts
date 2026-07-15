import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buffer Bros",
    short_name: "Buffer Bros",
    description: "Buffer Bros operations dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f8fb",
    theme_color: "#0a0e14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

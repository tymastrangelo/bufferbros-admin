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
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      // Drop real PNG exports of the Buffer Bros logo into public/icons and add them here.
    ],
  };
}

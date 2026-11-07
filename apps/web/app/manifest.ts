import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EVENTRA Adaptive Event Operations",
    short_name: "EVENTRA",
    description: "Adaptive event operations platform for real-time live event control",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F4F1EB",
    theme_color: "#100E0C",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

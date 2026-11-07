import type { MetadataRoute } from "next";

// Lets customers and cleaners add Ping to their home screen. The service worker for push
// alerts arrives with the cleaner app (Track B).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ping Clean",
    short_name: "Ping",
    description: "A cleaner home is just a Ping away.",
    start_url: "/login",
    display: "standalone",
    background_color: "#010c26",
    theme_color: "#011a3a",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

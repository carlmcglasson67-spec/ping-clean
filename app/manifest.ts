import type { MetadataRoute } from "next";

// Lets customers and cleaners add Ping to their home screen. Icons and the service
// worker for push alerts arrive with the cleaner app (Track B).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ping Clean",
    short_name: "Ping",
    description: "Your regular clean, sorted.",
    start_url: "/login",
    display: "standalone",
    background_color: "#f5f1e8",
    theme_color: "#11181f",
  };
}

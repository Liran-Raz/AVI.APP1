import type { MetadataRoute } from "next";

// PWA manifest. Lets users "Add to Home Screen" on iOS Safari and
// install via the address-bar icon on Chrome/Edge.
//
// No service worker for MVP — install criteria on modern mobile
// browsers don't require one for the "add to home screen" path, and
// we don't yet have an offline story worth shipping.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AVI.APP",
    short_name: "AVI",
    description:
      "ניהול משימות פנים-ארגונית למשרדי רואי חשבון — תור משימות, לוח שבועי, ניהול לקוחות.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#0d1c32",
    lang: "he",
    dir: "rtl",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
    ],
  };
}

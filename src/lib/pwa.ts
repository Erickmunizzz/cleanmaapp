import { createElement } from "react";

export function pwaHead(portal: "owner" | "cleaner") {
  return {
    meta: [
      { name: "theme-color", content: "#0f172a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "manifest", href: `/manifest-${portal}.webmanifest` },
      { rel: "apple-touch-icon", href: "/pwa/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts: [{ src: "/pwa/install.js", defer: true }],
  };
}

export function InstallGuide({ portal }: { portal: "owner" | "cleaner" }) {
  return createElement("cleanma-install", { "data-portal": portal });
}

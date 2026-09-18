import type { Metadata, MetadataRoute } from "next";

// Keep browser tabs, link previews and installed-app identity in one place.
export const site = {
  name: "Dalai Eej Operations",
  shortName: "Operations",
  origin: "https://ops.dalaieej.mn",
  description: "Private point of sale, orders, inventory and resort operations for Dalai Eej.",
} as const;

// Refresh previously cached icons while retaining the existing Dalai Eej mark.
const icon = (filename: string) => `/branding/favicons/${filename}?v=20260918`;

export const siteMetadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: { default: site.name, template: `%s · ${site.name}` },
  applicationName: site.name,
  description: site.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: icon("favicon.ico"), sizes: "any", type: "image/x-icon" },
      { url: icon("favicon-96x96.png"), sizes: "96x96", type: "image/png" },
      { url: icon("favicon.svg"), sizes: "any", type: "image/svg+xml" },
    ],
    shortcut: icon("favicon.ico"),
    apple: [{ url: icon("apple-touch-icon.png"), sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: site.shortName, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false, noarchive: true },
  openGraph: {
    type: "website", siteName: site.name, title: site.name, description: site.description,
    images: [{ url: icon("web-app-manifest-512x512.png"), width: 512, height: 512, alt: "Dalai Eej" }],
  },
  twitter: { card: "summary", title: site.name, description: site.description, images: [icon("web-app-manifest-512x512.png")] },
};

export const siteManifest: MetadataRoute.Manifest = {
  // Preserve the existing installation identity when names or launch paths change.
  id: "/",
  name: site.name,
  short_name: site.shortName,
  description: site.description,
  lang: "mn",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  categories: ["business", "productivity"],
  icons: [
    { src: icon("web-app-manifest-192x192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: icon("web-app-manifest-512x512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
  ],
};

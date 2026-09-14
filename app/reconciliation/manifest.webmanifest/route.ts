import type { MetadataRoute } from "next";

const manifest: MetadataRoute.Manifest = {
  id: "/reconciliation",
  name: "Далай Ээж · Тулгалт",
  short_name: "Тулгалт",
  description: "Банкны гүйлгээ болон баримтын хувийн тулгалт",
  start_url: "/reconciliation",
  scope: "/reconciliation",
  display: "standalone",
  orientation: "portrait",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  categories: ["finance", "business", "productivity"],
  icons: [
    {
      src: "/branding/favicons/web-app-manifest-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=86400",
      "Content-Type": "application/manifest+json",
    },
  });
}

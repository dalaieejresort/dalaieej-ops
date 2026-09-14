import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Тулгалт",
  description: "Банкны гүйлгээ, баримтын хувийн шалгалт",
  applicationName: "Далай Ээж · Тулгалт",
  manifest: "/reconciliation/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Тулгалт",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function ReconciliationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}

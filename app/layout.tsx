import type { Metadata, Viewport } from "next";
import { ConnectivityStatus } from "@/components/system/ConnectivityStatus";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dalai Eej Ops",
  description: "Dalai Eej Resort adaptive operations app and POS",
  applicationName: "Dalai Eej Ops",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/app-icon.svg",
    shortcut: "/favicon.ico",
    apple: "/app-icon.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Dalai Ops",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="mn" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <ConnectivityStatus />
        {children}
      </body>
    </html>
  );
}

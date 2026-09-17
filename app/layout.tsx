import type { Metadata, Viewport } from "next";
import { SessionControls } from "@/components/auth/SessionControls";
import { ConnectivityStatus } from "@/components/system/ConnectivityStatus";
import { getServerSession } from "@/lib/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dalai Eej Ops",
  description: "Dalai Eej Resort adaptive operations app and POS",
  applicationName: "Dalai Eej Ops",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/branding/favicons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/branding/favicons/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/branding/favicons/favicon.ico",
    apple: [{ url: "/branding/favicons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Dalai Ops",
    statusBarStyle: "black-translucent",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession();

  return (
    <html lang="mn" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <ConnectivityStatus role={session?.role} />
        {children}
        {session && (
          <SessionControls displayName={session.displayName} role={session.role} />
        )}
      </body>
    </html>
  );
}

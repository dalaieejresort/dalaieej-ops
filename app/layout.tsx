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
    icon: "/app-icon.svg",
    shortcut: "/favicon.ico",
    apple: "/app-icon.svg",
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
  themeColor: "#047857",
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
        <ConnectivityStatus />
        {children}
        {session && (
          <SessionControls displayName={session.displayName} role={session.role} />
        )}
      </body>
    </html>
  );
}

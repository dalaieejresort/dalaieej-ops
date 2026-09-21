import { siteMetadata } from "@/lib/site-branding";
import type { Metadata, Viewport } from "next";
import { SessionControls } from "@/components/auth/SessionControls";
import { ConnectivityStatus } from "@/components/system/ConnectivityStatus";
import { getServerSession } from "@/lib/server/auth";
import "./globals.css";

export const metadata: Metadata = siteMetadata;

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
        <ConnectivityStatus />
        {children}
        {session && (
          <SessionControls displayName={session.displayName} role={session.role} />
        )}
      </body>
    </html>
  );
}

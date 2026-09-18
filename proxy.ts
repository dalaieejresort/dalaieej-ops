import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "dalaieej_ops_session";
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/health",
  // This route verifies CRON_SECRET itself; scheduled requests have no login cookie.
  "/api/cron/pos-backup",
  "/api/telegram-webhook",
]);

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Service clients must use the new origin directly: redirects may drop bearer headers.
  if (["/api/reconciliation", "/api/receipt-payments"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )) {
    const targetPath = pathname === "/api/reconciliation/paid-via"
      ? "/api/receipt-payments/paid-via" : pathname;
    return NextResponse.json(
      { error: "Receipts API moved. Update the client URL and credentials.",
        code: "RECEIPTS_MOVED", endpoint: `https://receipts.dalaieej.mn${targetPath}` },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Нэвтэрч орно уу.", code: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|branding/favicons/|favicon.ico|icon.png|app-icon.svg|manifest.webmanifest|sw.js).*)"],
};

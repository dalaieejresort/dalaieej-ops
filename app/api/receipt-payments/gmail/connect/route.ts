import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestSession, hasMinimumRole } from "@/lib/server/auth";
import { CONNECTION_PAGE, CALLBACK_PATH, STATE_COOKIE, receiptSetup, receiptRedirectUri } from "@/lib/receipt-payments/config";
import { receiptAuthorizationUrl } from "@/lib/receipt-payments/oauth";

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session || !hasMinimumRole(session, "owner")) {
    return NextResponse.redirect(new URL(`/login?next=${CONNECTION_PAGE}`, request.url));
  }
  try {
    if (!Object.values(receiptSetup()).every(Boolean)) throw new Error("setup");
    const callbackOrigin = new URL(receiptRedirectUri()).origin;
    // Keep the state cookie and callback on the same host across custom domains.
    if (new URL(request.url).origin !== callbackOrigin) {
      const response = NextResponse.redirect(
        new URL("/api/receipt-payments/gmail/connect", callbackOrigin),
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(receiptAuthorizationUrl(state));
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: CALLBACK_PATH, maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL(`${CONNECTION_PAGE}?status=setup-required`, request.url));
  }
}

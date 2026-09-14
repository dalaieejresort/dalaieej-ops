import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestSession, hasMinimumRole } from "@/lib/server/auth";
import {
  createGmailAuthorizationUrl,
  gmailRedirectUri,
} from "@/lib/reconciliation/gmail";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session || !hasMinimumRole(session, "owner")) {
    return NextResponse.redirect(new URL("/login?next=/reconciliation", request.url));
  }

  try {
    const redirectUri = gmailRedirectUri(request.url);
    const callbackOrigin = new URL(redirectUri).origin;
    // OAuth state cookies must be created on the registered callback's host.
    if (new URL(request.url).origin !== callbackOrigin) {
      const response = NextResponse.redirect(
        new URL("/api/reconciliation/gmail/connect", callbackOrigin),
      );
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(
      createGmailAuthorizationUrl({
        redirectUri,
        state,
      }),
    );
    response.cookies.set("reconciliation_gmail_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/reconciliation/gmail/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/reconciliation?gmail=configuration-error", request.url),
    );
  }
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getRequestSession, hasMinimumRole } from "@/lib/server/auth";
import {
  completeGmailAuthorization,
  gmailRedirectUri,
} from "@/lib/reconciliation/gmail";

export const dynamic = "force-dynamic";

function sameState(expected: string | undefined, supplied: string | null) {
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session || !hasMinimumRole(session, "owner")) {
    return NextResponse.redirect(new URL("/login?next=/reconciliation", request.url));
  }

  const url = new URL(request.url);
  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("reconciliation_gmail_oauth_state="))
    ?.split("=")[1];
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  let outcome = "connected";

  if (!sameState(expectedState, state) || !code) {
    console.warn(
      JSON.stringify({
        level: "warning",
        message: "Gmail authorization callback rejected",
        route: "/api/reconciliation/gmail/callback",
        hasExpectedState: Boolean(expectedState),
        hasSuppliedState: Boolean(state),
        hasAuthorizationCode: Boolean(code),
      }),
    );
    outcome = "authorization-error";
  } else {
    try {
      await completeGmailAuthorization({
        redirectUri: gmailRedirectUri(request.url),
        code,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Gmail authorization callback failed",
          route: "/api/reconciliation/gmail/callback",
          error:
            error instanceof Error ? error.message : "Unknown authorization error",
        }),
      );
      outcome = "authorization-error";
    }
  }

  const response = NextResponse.redirect(
    new URL(`/reconciliation?gmail=${outcome}`, request.url),
  );
  response.cookies.set("reconciliation_gmail_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/reconciliation/gmail/callback",
    maxAge: 0,
  });
  return response;
}

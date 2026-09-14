import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequestSession, hasMinimumRole } from "@/lib/server/auth";
import { CONNECTION_PAGE, CALLBACK_PATH, STATE_COOKIE } from "@/lib/receipt-payments/config";
import { completeReceiptAuthorization } from "@/lib/receipt-payments/oauth";

export async function GET(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || !hasMinimumRole(session, "owner")) {
    return NextResponse.redirect(new URL(`/login?next=${CONNECTION_PAGE}`, request.url));
  }
  const expected = request.cookies.get(STATE_COOKIE)?.value || "";
  const supplied = request.nextUrl.searchParams.get("state") || "";
  const code = request.nextUrl.searchParams.get("code");
  let status = "authorization-error";
  if (expected && supplied && code && Buffer.byteLength(expected) === Buffer.byteLength(supplied) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    try {
      await completeReceiptAuthorization(code);
      status = "connected";
    } catch (error) {
      if (error instanceof Error && error.message === "wrong_mailbox") status = "wrong-mailbox";
    }
  }
  const response = NextResponse.redirect(new URL(`${CONNECTION_PAGE}?status=${status}`, request.url));
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: CALLBACK_PATH, maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

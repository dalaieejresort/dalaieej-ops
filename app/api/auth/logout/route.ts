import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server/auth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}

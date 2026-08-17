import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server/auth";

export async function GET(request: Request) {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      username: session.username,
      displayName: session.displayName,
      role: session.role,
    },
  });
}

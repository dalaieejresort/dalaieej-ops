import { NextResponse } from "next/server";
import {
  applySessionCookie,
  authenticateAccount,
  createSessionToken,
} from "@/lib/server/auth";

type AttemptState = { count: number; resetAt: number };
const attempts = new Map<string, AttemptState>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(key: string) {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  state.count += 1;
  return state.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const key = clientKey(request);
  if (isRateLimited(key)) {
    return NextResponse.json(
      { error: "Олон удаа буруу оролдлоо. 10 минутын дараа дахин оролдоно уу." },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
    };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password || password.length > 256) {
      return NextResponse.json(
        { error: "Хэрэглэгчийн нэр болон нууц үгээ оруулна уу." },
        { status: 400 },
      );
    }

    const account = authenticateAccount(username, password);
    if (!account) {
      return NextResponse.json(
        { error: "Хэрэглэгчийн нэр эсвэл нууц үг буруу байна." },
        { status: 401 },
      );
    }

    attempts.delete(key);
    const response = NextResponse.json({
      success: true,
      user: account,
    });
    applySessionCookie(response, createSessionToken(account));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "login_failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json(
      { error: "Нэвтрэх систем тохируулагдаагүй байна." },
      { status: 503 },
    );
  }
}

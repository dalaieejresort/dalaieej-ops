import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  requireApiSession,
  type OpsRole,
} from "@/lib/server/auth";

type RouteHandler = (request: Request) => Promise<Response>;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export function withProtectedApiRoute(
  route: string,
  minimumRole: OpsRole,
  handler: RouteHandler,
): RouteHandler {
  return async (request) => {
    const startedAt = Date.now();
    const requestId = request.headers.get("x-vercel-id") || randomUUID();
    const method = request.method.toUpperCase();
    const sessionOrResponse = requireApiSession(request, minimumRole);

    console.info(JSON.stringify({
      level: "info",
      message: "request_started",
      route,
      method,
      requestId,
    }));

    if (sessionOrResponse instanceof NextResponse) {
      sessionOrResponse.headers.set("x-request-id", requestId);
      console.warn(JSON.stringify({
        level: "warning",
        message: "request_rejected",
        route,
        method,
        requestId,
        status: sessionOrResponse.status,
        durationMs: Date.now() - startedAt,
      }));
      return sessionOrResponse;
    }

    if (method !== "GET" && method !== "HEAD" && !sameOrigin(request)) {
      const response = NextResponse.json(
        { error: "Invalid request origin", code: "INVALID_ORIGIN" },
        { status: 403 },
      );
      response.headers.set("x-request-id", requestId);
      return response;
    }

    try {
      const response = await handler(request);
      response.headers.set("x-request-id", requestId);
      console.info(JSON.stringify({
        level: response.status >= 500 ? "error" : "info",
        message: "request_completed",
        route,
        method,
        requestId,
        role: sessionOrResponse.role,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }));
      return response;
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: "request_failed",
        route,
        method,
        requestId,
        role: sessionOrResponse.role,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }));
      const response = NextResponse.json(
        { error: "Internal server error", requestId },
        { status: 500 },
      );
      response.headers.set("x-request-id", requestId);
      return response;
    }
  };
}

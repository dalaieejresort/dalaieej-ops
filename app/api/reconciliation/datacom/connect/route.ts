import { NextResponse } from "next/server";
import { connectDatacomMailbox } from "@/lib/reconciliation/datacom";
import { withProtectedApiRoute } from "@/lib/server/api-route";

export const maxDuration = 30;

async function handlePOST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Expected a secure JSON request" },
      { status: 415 },
    );
  }
  const body = (await request.json().catch(() => null)) as
    | { emailAddress?: unknown; password?: unknown }
    | null;
  if (
    typeof body?.emailAddress !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { error: "Email address and password are required" },
      { status: 400 },
    );
  }
  try {
    const emailAddress = await connectDatacomMailbox({
      emailAddress: body.emailAddress,
      password: body.password,
    });
    return NextResponse.json(
      { connected: true, emailAddress },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Datacom email connection failed",
      },
      { status: 400 },
    );
  }
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/datacom/connect",
  "owner",
  handlePOST,
);

import { NextResponse } from "next/server";
import { disconnectGmailAuthorization } from "@/lib/reconciliation/gmail";
import { withProtectedApiRoute } from "@/lib/server/api-route";

async function handlePOST() {
  try {
    const emailAddress = await disconnectGmailAuthorization();
    return NextResponse.json(
      { disconnected: Boolean(emailAddress), emailAddress },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gmail disconnection failed",
      },
      { status: 400 },
    );
  }
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/gmail/disconnect",
  "owner",
  handlePOST,
);

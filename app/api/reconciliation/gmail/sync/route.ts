import { NextResponse } from "next/server";
import { syncKhanBankGmail } from "@/lib/reconciliation/gmail";
import { withProtectedApiRoute } from "@/lib/server/api-route";

async function handlePOST(request: Request) {
  try {
    const rawLimit = new URL(request.url).searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 100)
    ) {
      return NextResponse.json(
        { error: "Sync limit must be a whole number between 1 and 100" },
        { status: 400 },
      );
    }
    const result = await syncKhanBankGmail({ limit });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Khan Bank Gmail synchronization failed",
      },
      { status: 400 },
    );
  }
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/gmail/sync",
  "owner",
  handlePOST,
);

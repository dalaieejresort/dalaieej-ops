import { NextResponse } from "next/server";
import { syncBankEmailDatacom } from "@/lib/reconciliation/datacom";
import { withProtectedApiRoute } from "@/lib/server/api-route";

export const maxDuration = 60;

async function handlePOST(request: Request) {
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const date = new URL(request.url).searchParams.get("date") || undefined;
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
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Date must use YYYY-MM-DD format" },
      { status: 400 },
    );
  }
  try {
    const result = await syncBankEmailDatacom({ limit, date });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Datacom bank-email synchronization failed",
      },
      { status: 400 },
    );
  }
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/datacom/sync",
  "owner",
  handlePOST,
);

import { NextResponse } from "next/server";
import { disconnectDatacomMailbox } from "@/lib/reconciliation/datacom";
import { withProtectedApiRoute } from "@/lib/server/api-route";

async function handlePOST() {
  const emailAddress = await disconnectDatacomMailbox();
  return NextResponse.json(
    { disconnected: Boolean(emailAddress), emailAddress },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/datacom/disconnect",
  "owner",
  handlePOST,
);

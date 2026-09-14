import { NextResponse } from "next/server";
import { disconnectYahooMailbox } from "@/lib/reconciliation/yahoo";
import { withProtectedApiRoute } from "@/lib/server/api-route";

async function handlePOST() {
  const emailAddress = await disconnectYahooMailbox();
  return NextResponse.json(
    { disconnected: Boolean(emailAddress), emailAddress },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const POST = withProtectedApiRoute(
  "/api/reconciliation/yahoo/disconnect",
  "owner",
  handlePOST,
);

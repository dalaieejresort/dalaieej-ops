import { NextResponse } from "next/server";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import { listLiveOrders } from "@/lib/server/live-order-board";

async function handleGET() {
  const board = await listLiveOrders();
  return NextResponse.json(
    { ...board, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const GET = withProtectedApiRoute(
  "/api/live-orders",
  "waiter",
  handleGET,
);

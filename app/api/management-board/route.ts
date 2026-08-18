import { NextResponse } from "next/server";
import { isValidBusinessDate } from "@/lib/pos/business-date";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import { listLiveOrders } from "@/lib/server/live-order-board";
import { getManagementBoardSnapshot } from "@/lib/server/management-board";

async function handleGET(request: Request) {
  const businessDate = new URL(request.url).searchParams
    .get("businessDate")
    ?.trim();
  if (!businessDate || !isValidBusinessDate(businessDate)) {
    return NextResponse.json(
      { error: "Valid businessDate is required" },
      { status: 400 },
    );
  }

  const [snapshot, liveOrders] = await Promise.all([
    getManagementBoardSnapshot(businessDate),
    listLiveOrders(),
  ]);
  const sales = snapshot.sections.sales;
  if (
    liveOrders.initialized &&
    sales &&
    typeof sales === "object" &&
    !Array.isArray(sales)
  ) {
    snapshot.sections.sales = { ...sales, charges: liveOrders.orders };
  }
  const liveUpdatedAt = liveOrders.orders
    .map((order) => order.updatedAt)
    .filter(Boolean)
    .sort((first, second) => second.localeCompare(first))[0];
  const updatedAt = [snapshot.updatedAt, liveUpdatedAt]
    .filter((value): value is string => Boolean(value))
    .sort((first, second) => second.localeCompare(first))[0] ?? null;

  return NextResponse.json(
    {
      ...snapshot,
      updatedAt,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const GET = withProtectedApiRoute(
  "/api/management-board",
  "manager",
  handleGET,
);

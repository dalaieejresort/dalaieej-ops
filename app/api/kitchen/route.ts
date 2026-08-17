import { NextResponse } from "next/server";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import { requireApiSession } from "@/lib/server/auth";
import {
  listKitchenOrders,
  updateKitchenOrderStatus,
} from "@/lib/server/kitchen-queue";

type KitchenPatchBody = {
  orderId?: string;
  action?: "start" | "ready" | "reopen" | "archive";
};

async function handleGET(request: Request) {
  const businessDate = new URL(request.url).searchParams.get("businessDate")?.trim();
  if (!businessDate) {
    return NextResponse.json({ error: "businessDate is required" }, { status: 400 });
  }
  const orders = await listKitchenOrders(businessDate);
  return NextResponse.json(
    { orders, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function handlePATCH(request: Request) {
  const sessionOrResponse = requireApiSession(request, "kitchen");
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
  const body = (await request.json()) as KitchenPatchBody;
  const orderId = body.orderId?.trim() ?? "";
  const action = body.action;
  if (!orderId || !action || !["start", "ready", "reopen", "archive"].includes(action)) {
    return NextResponse.json({ error: "Valid orderId and action are required" }, { status: 400 });
  }
  const order = await updateKitchenOrderStatus(
    orderId,
    action,
    sessionOrResponse.displayName,
  );
  if (!order) {
    return NextResponse.json({ error: "Kitchen order not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, order });
}

export const GET = withProtectedApiRoute("/api/kitchen", "kitchen", handleGET);
export const PATCH = withProtectedApiRoute("/api/kitchen", "kitchen", handlePATCH);

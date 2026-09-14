import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  getReceiptFile,
  getReceiptUploadTarget,
} from "@/lib/reconciliation/database";
import { withProtectedApiRoute } from "@/lib/server/api-route";

export const dynamic = "force-dynamic";

function safeHeaderFilename(value: string) {
  return value
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 160) || "receipt";
}

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  if (eventId) {
    if (!/^\d+$/.test(eventId)) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    const target = await getReceiptUploadTarget(eventId);
    return NextResponse.json(
      { receiptId: target?.receiptId ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const receiptId = url.searchParams.get("id");
  if (!receiptId || !/^\d+$/.test(receiptId)) {
    return NextResponse.json({ error: "Invalid receipt" }, { status: 400 });
  }
  const receipt = await getReceiptFile(receiptId);
  if (!receipt) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  const blob = await get(receipt.storageReference, {
    access: "private",
    useCache: false,
  });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Receipt file not found" }, { status: 404 });
  }
  return new Response(blob.stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${safeHeaderFilename(receipt.originalFilename)}"`,
      "Content-Length": String(receipt.fileSizeBytes),
      "Content-Type": receipt.contentType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withProtectedApiRoute(
  "/api/reconciliation/receipts",
  "owner",
  handleGET,
);

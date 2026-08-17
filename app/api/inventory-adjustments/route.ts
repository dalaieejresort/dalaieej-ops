import {
  GoogleSpreadsheet,
  type GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/auth";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import {
  DAY_SESSION_HEADERS,
  requireActiveBusinessSession,
} from "@/lib/server/business-session";
import { staleBusinessDayResponse } from "@/lib/server/business-day-guard";
import {
  operationFingerprint,
  operationTimestamp,
} from "@/lib/server/operation-controls";
import { clearCachedReads } from "@/lib/server/read-cache";

const INVENTORY_HEADERS = [
  "Transaction ID",
  "Timestamp",
  "SKU (Барааны код)",
  "Item Description",
  "Type (Хөдөлгөөн)",
  "Quantity (Тоо)",
  "Location (Байршил)",
  "Handled By",
  "Payment Method",
  "Room Number",
  "Session ID",
  "Business Date",
  "Adjustment Reason",
  "Client Request ID",
  "Operation Status",
  "Request Fingerprint",
  "Operation Updated At",
] as const;

type AdjustmentBody = {
  clientRequestId?: string;
  reason?: string;
  adjustments?: Array<{
    sku?: string;
    name?: string;
    quantityDelta?: number;
  }>;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value.replace(/^"|"$/g, "");
}

function createDoc() {
  const auth = new JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return new GoogleSpreadsheet(requiredEnv("GOOGLE_SHEET_ID"), auth);
}

async function ensureHeaders(
  sheet: GoogleSpreadsheetWorksheet,
  headers: readonly string[],
) {
  await sheet.loadHeaderRow();
  const missing = headers.filter(header => !sheet.headerValues.includes(header));
  if (missing.length === 0) return;
  const nextHeaders = [...sheet.headerValues, ...missing];
  if (nextHeaders.length > sheet.columnCount) {
    await sheet.resize({ rowCount: sheet.rowCount, columnCount: nextHeaders.length });
  }
  await sheet.setHeaderRow(nextHeaders);
}

async function handlePOST(request: Request) {
  const sessionOrResponse = requireApiSession(request, "manager");
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;

  try {
    const body = (await request.json()) as AdjustmentBody;
    const clientRequestId = body.clientRequestId?.trim() ?? "";
    const reason = body.reason?.trim() ?? "";
    const adjustments = (body.adjustments ?? [])
      .map(item => ({
        sku: item.sku?.trim() ?? "",
        name: item.name?.trim() ?? "",
        quantityDelta: Number(item.quantityDelta ?? 0),
      }))
      .filter(
        item =>
          item.sku &&
          Number.isFinite(item.quantityDelta) &&
          item.quantityDelta !== 0 &&
          Math.abs(item.quantityDelta) <= 1_000_000,
      );
    if (!clientRequestId || clientRequestId.length > 128) {
      return NextResponse.json(
        { error: "clientRequestId is required and must be 128 characters or less" },
        { status: 400 },
      );
    }
    if ((body.adjustments?.length ?? 0) > 100 || reason.length > 500) {
      return NextResponse.json(
        { error: "Adjustment request is too large" },
        { status: 400 },
      );
    }
    if (!reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    if (adjustments.length === 0) {
      return NextResponse.json(
        { error: "At least one non-zero inventory adjustment is required" },
        { status: 400 },
      );
    }

    const fingerprint = operationFingerprint({ action: "inventory-adjustment", reason, adjustments });
    const doc = createDoc();
    await doc.loadInfo();
    const inventorySheet =
      doc.sheetsByTitle[process.env.GOOGLE_LOG_SHEET_TITLE ?? ""] ??
      doc.sheetsByTitle.Inventory_Log ??
      doc.sheetsByTitle.inventory_log;
    const daySheet =
      doc.sheetsByTitle[process.env.GOOGLE_DAY_SESSION_SHEET_TITLE ?? ""] ??
      doc.sheetsByTitle.Day_Sessions ??
      doc.sheetsByTitle.day_sessions;
    if (!inventorySheet || !daySheet) {
      throw new Error("Inventory_Log or Day_Sessions is missing");
    }
    await Promise.all([
      ensureHeaders(inventorySheet, INVENTORY_HEADERS),
      ensureHeaders(daySheet, DAY_SESSION_HEADERS),
    ]);
    const [inventoryRows, dayRows] = await Promise.all([
      inventorySheet.getRows(),
      daySheet.getRows(),
    ]);
    const existingRows = inventoryRows.filter(
      row => String(row.get("Client Request ID") ?? "").trim() === clientRequestId,
    );
    if (existingRows.length > 0) {
      const storedFingerprint = String(
        existingRows[0].get("Request Fingerprint") ?? "",
      ).trim();
      if (storedFingerprint !== fingerprint) {
        return NextResponse.json(
          { error: "This request ID was already used for a different adjustment" },
          { status: 409 },
        );
      }
      return NextResponse.json({
        success: true,
        duplicateRequest: true,
        adjustedCount: existingRows.length,
        clientRequestId,
      });
    }

    const activeSession = requireActiveBusinessSession(dayRows);
    const staleResponse = staleBusinessDayResponse(activeSession.businessDate);
    if (staleResponse) return staleResponse;
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Ulaanbaatar",
    });
    const updatedAt = operationTimestamp();
    await inventorySheet.addRows(
      adjustments.map(item => ({
        "Transaction ID": `ADJ-${clientRequestId}`,
        Timestamp: timestamp,
        "SKU (Барааны код)": item.sku,
        "Item Description": item.name || item.sku,
        // Reuse the movement vocabulary already understood by the catalog formulas;
        // the dedicated audit columns identify this as a reconciliation adjustment.
        "Type (Хөдөлгөөн)": item.quantityDelta > 0 ? "Буцаалт" : "Зарлага",
        "Quantity (Тоо)": Math.abs(item.quantityDelta),
        "Location (Байршил)": "Front Desk",
        "Handled By": sessionOrResponse.displayName,
        "Payment Method": "Inventory reconciliation",
        "Room Number": "",
        "Session ID": activeSession.sessionId,
        "Business Date": activeSession.businessDate,
        "Adjustment Reason": reason,
        "Client Request ID": clientRequestId,
        "Operation Status": "complete",
        "Request Fingerprint": fingerprint,
        "Operation Updated At": updatedAt,
      })),
    );
    clearCachedReads("inventory:");
    return NextResponse.json({
      success: true,
      adjustedCount: adjustments.length,
      clientRequestId,
      businessDate: activeSession.businessDate,
    });
  } catch (error) {
    console.error(
      `[inventory-adjustment] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Failed to record inventory adjustment" },
      { status: 500 },
    );
  }
}

export const POST = withProtectedApiRoute(
  "/api/inventory-adjustments",
  "manager",
  handlePOST,
);

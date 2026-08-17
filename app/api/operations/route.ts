import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/auth";
import { withProtectedApiRoute } from "@/lib/server/api-route";

const OPERATION_SHEETS = [
  {
    titles: [process.env.GOOGLE_SALES_SHEET_TITLE, "Sales_Log", "sales_log"],
    type: "sale",
    idColumn: "transaction_id",
    actorColumn: "staff",
    timestampColumn: "timestamp",
  },
  {
    titles: [process.env.GOOGLE_RECEIPTS_SHEET_TITLE, "Receipts_Log", "receipts_log"],
    type: "settlement",
    idColumn: "receipt_id",
    actorColumn: "staff",
    timestampColumn: "timestamp",
  },
  {
    titles: [process.env.GOOGLE_VOIDS_SHEET_TITLE, "Voids_Log", "voids_log"],
    type: "void",
    idColumn: "void_id",
    actorColumn: "staff",
    timestampColumn: "timestamp",
  },
  {
    titles: [process.env.GOOGLE_DAY_SESSION_SHEET_TITLE, "Day_Sessions", "day_sessions"],
    type: "day",
    idColumn: "session_id",
    actorColumn: "opened_by",
    timestampColumn: "opened_at",
  },
] as const;

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

async function handleGET(request: Request) {
  const sessionOrResponse = requireApiSession(request, "manager");
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;

  try {
    const doc = createDoc();
    await doc.loadInfo();
    const pending = (
      await Promise.all(
        OPERATION_SHEETS.map(async config => {
          const sheet = config.titles
            .filter(Boolean)
            .map(title => doc.sheetsByTitle[String(title)])
            .find(Boolean);
          if (!sheet) return [];
          await sheet.loadHeaderRow();
          if (!sheet.headerValues.includes("operation_status")) return [];
          const rows = await sheet.getRows();
          return rows
            .filter(row => String(row.get("operation_status") ?? "").trim() === "pending")
            .map(row => ({
              type: config.type,
              requestId: String(row.get("client_request_id") ?? "").trim(),
              resourceId: String(row.get(config.idColumn) ?? "").trim(),
              businessDate: String(row.get("business_date") ?? "").trim(),
              actor: String(row.get(config.actorColumn) ?? "").trim(),
              timestamp: String(row.get(config.timestampColumn) ?? "").trim(),
              updatedAt: String(row.get("operation_updated_at") ?? "").trim(),
              error: String(row.get("operation_error") ?? "").trim(),
              recoverable: Boolean(
                String(row.get("client_request_id") ?? "").trim() &&
                  String(row.get("request_fingerprint") ?? "").trim(),
              ),
            }));
        }),
      )
    ).flat();

    return NextResponse.json({ pending });
  } catch (error) {
    console.error(
      `[operations:get] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Failed to load operation diagnostics" },
      { status: 500 },
    );
  }
}

export const GET = withProtectedApiRoute("/api/operations", "manager", handleGET);

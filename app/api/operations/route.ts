import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { after, NextResponse } from "next/server";
import { isValidBusinessDate } from "@/lib/pos/business-date";
import { requireApiSession } from "@/lib/server/auth";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import { getCachedRead } from "@/lib/server/read-cache";
import { mergeManagementBoardSectionSafely } from "@/lib/server/management-board";

const OPERATIONS_CACHE_TTL_MS = 60_000;
const SHEET_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedSpreadsheet:
  | { expiresAt: number; promise: Promise<GoogleSpreadsheet> }
  | undefined;

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

async function loadSpreadsheet() {
  const now = Date.now();
  if (cachedSpreadsheet && cachedSpreadsheet.expiresAt > now) {
    return cachedSpreadsheet.promise;
  }
  const promise = (async () => {
    const doc = createDoc();
    await doc.loadInfo();
    return doc;
  })();
  cachedSpreadsheet = {
    expiresAt: now + SHEET_METADATA_CACHE_TTL_MS,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (cachedSpreadsheet?.promise === promise) cachedSpreadsheet = undefined;
    throw error;
  }
}

async function handleGET(request: Request) {
  const sessionOrResponse = requireApiSession(request, "manager");
  if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;

  try {
    const url = new URL(request.url);
    const loadPending = async () => {
        const doc = await loadSpreadsheet();
        const available = OPERATION_SHEETS.flatMap(config => {
          const sheet = config.titles
            .filter(Boolean)
            .map(title => doc.sheetsByTitle[String(title)])
            .find(Boolean);
          return sheet ? [{ config, sheet }] : [];
        });
        if (available.length === 0) return [];
        const rangeQuery = available
          .map(({ sheet }) =>
            `ranges=${encodeURIComponent(`${sheet.a1SheetName}!A:ZZ`)}`,
          )
          .join("&");
        const response = await doc.sheetsApi.get(
          `values:batchGet?${rangeQuery}`,
          {
            searchParams: {
              majorDimension: "ROWS",
              valueRenderOption: "FORMATTED_VALUE",
            },
          },
        );
        const payload = (await response.json()) as {
          valueRanges?: Array<{ values?: unknown[][] }>;
        };
        return available.flatMap(({ config }, index) => {
          const values = payload.valueRanges?.[index]?.values ?? [];
          const headers = (values[0] ?? []).map(value =>
            String(value ?? "").trim(),
          );
          const get = (row: unknown[], column: string) => {
            const columnIndex = headers.indexOf(column);
            return columnIndex >= 0
              ? String(row[columnIndex] ?? "").trim()
              : "";
          };
          return values.slice(1).flatMap(row => {
            if (get(row, "operation_status") !== "pending") return [];
            const requestId = get(row, "client_request_id");
            return [{
              type: config.type,
              requestId,
              resourceId: get(row, config.idColumn),
              businessDate: get(row, "business_date"),
              actor: get(row, config.actorColumn),
              timestamp: get(row, config.timestampColumn),
              updatedAt: get(row, "operation_updated_at"),
              error: get(row, "operation_error"),
              recoverable: Boolean(
                requestId && get(row, "request_fingerprint"),
              ),
            }];
          });
        });
      };
    const pending =
      url.searchParams.get("fresh") === "1"
        ? await loadPending()
        : await getCachedRead(
            "operations:pending",
            OPERATIONS_CACHE_TTL_MS,
            loadPending,
          );
    const businessDate = url.searchParams.get("businessDate")?.trim() ?? "";
    if (isValidBusinessDate(businessDate)) {
      after(() =>
        mergeManagementBoardSectionSafely(
          businessDate,
          "operations",
          { pending },
        ),
      );
    }

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

import "server-only";

import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { getUlaanbaatarBusinessDate } from "@/lib/pos/business-date";
import { getCachedRead } from "@/lib/server/read-cache";

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
};

const ACTIVE_BUSINESS_DATE_CACHE_TTL_MS = 5000;

const DAY_SESSION_SHEET_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  "Day_Sessions",
  "day_sessions",
].filter(Boolean) as string[];

const DAY_SESSION_HEADERS = [
  "business_date",
  "opened_at",
  "opened_by",
  "starting_cash",
  "status",
  "closed_at",
  "closed_by",
  "counted_cash",
  "expected_cash",
  "cash_difference",
  "payment_total",
  "cash_payment_total",
  "card_payment_total",
  "qpay_payment_total",
  "other_payment_total",
  "room_charge_total",
  "sales_total",
  "notes",
];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value.replace(/^"|"$/g, "");
}

function getPrivateKey() {
  const key = requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
  const keyLines = key.split("\n");
  const keyBody = keyLines.slice(1, -1).join("");

  if (
    !key.startsWith("-----BEGIN PRIVATE KEY-----") ||
    !key.endsWith("-----END PRIVATE KEY-----") ||
    /[^A-Za-z0-9+/=]/.test(keyBody)
  ) {
    throw new Error("GOOGLE_PRIVATE_KEY is not a valid service-account private key");
  }

  return key;
}

function createDoc(): SheetDoc {
  const serviceAccountAuth = new JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return new GoogleSpreadsheet(requiredEnv("GOOGLE_SHEET_ID"), serviceAccountAuth);
}

async function loadSpreadsheet() {
  const doc = createDoc();
  await doc.loadInfo();
  return doc;
}

async function getOrCreateDaySessionSheet(doc: SheetDoc) {
  for (const title of DAY_SESSION_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return doc.addSheet({
    title: DAY_SESSION_SHEET_TITLES[0] ?? "Day_Sessions",
    headerValues: DAY_SESSION_HEADERS,
  });
}

function getCell(row: SheetRow, column: string) {
  return String(row.get(column) ?? "").trim();
}

function getLatestOpenBusinessDate(rows: SheetRow[]) {
  const openSession = rows
    .slice()
    .reverse()
    .find(
      (row) =>
        getCell(row, "status").toLowerCase() === "open" &&
        getCell(row, "business_date"),
    );

  return openSession ? getCell(openSession, "business_date") : "";
}

async function loadActiveBusinessDate() {
  const doc = await loadSpreadsheet();
  const daySessionSheet = await getOrCreateDaySessionSheet(doc);
  const rows = (await daySessionSheet.getRows()) as SheetRow[];

  return getLatestOpenBusinessDate(rows) || getUlaanbaatarBusinessDate();
}

export async function getActiveBusinessDate() {
  return getCachedRead(
    "business-date:active",
    ACTIVE_BUSINESS_DATE_CACHE_TTL_MS,
    async () => {
      try {
        return await loadActiveBusinessDate();
      } catch (error) {
        console.warn(
          `Active business date fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return getUlaanbaatarBusinessDate();
      }
    },
  );
}

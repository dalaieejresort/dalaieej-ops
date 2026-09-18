import { withPosTransaction } from "./pos-storage/transaction";
import { createPosDocument, posBackend, type PosDocument } from "@/lib/server/pos-storage";
import "server-only";

import { getUlaanbaatarBusinessDate } from "@/lib/pos/business-date";
import {
  DAY_SESSION_HEADERS,
  getActiveBusinessSession,
} from "@/lib/server/business-session";
import { getCachedRead } from "@/lib/server/read-cache";

type SheetDoc = PosDocument;

type SheetRow = {
  get: (columnName: string) => unknown;
  rowNumber?: number;
};

const ACTIVE_BUSINESS_DATE_CACHE_TTL_MS = 5000;

const DAY_SESSION_SHEET_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  "Day_Sessions",
  "day_sessions",
].filter(Boolean) as string[];

function createDoc() { return createPosDocument(); }

async function loadSpreadsheet() {
  if (posBackend() === "postgres") { const doc = createDoc(); await doc.loadInfo(); return doc; }
  const doc = createDoc();
  await doc.loadInfo();
  return doc;
}

async function getOrCreateDaySessionSheet(doc: SheetDoc) {
  for (const title of DAY_SESSION_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) {
      await sheet.loadHeaderRow();
      const missingHeaders = DAY_SESSION_HEADERS.filter(
        header => !sheet.headerValues.includes(header),
      );

      if (missingHeaders.length > 0) {
        const nextHeaders = [...sheet.headerValues, ...missingHeaders];
        if (nextHeaders.length > sheet.columnCount) {
          await sheet.resize({
            rowCount: sheet.rowCount,
            columnCount: nextHeaders.length,
          });
        }
        await sheet.setHeaderRow(nextHeaders);
      }

      return sheet;
    }
  }

  return doc.addSheet({
    title: DAY_SESSION_SHEET_TITLES[0] ?? "Day_Sessions",
    headerValues: [...DAY_SESSION_HEADERS],
  });
}

function getLatestOpenBusinessDate(rows: SheetRow[]) {
  return getActiveBusinessSession(rows)?.businessDate ?? "";
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
        return await withPosTransaction(loadActiveBusinessDate);
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

import "server-only";

import type {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";

export function userEnteredCell(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { userEnteredValue: { numberValue: value } };
  }
  if (typeof value === "boolean") {
    return { userEnteredValue: { boolValue: value } };
  }
  return { userEnteredValue: { stringValue: String(value ?? "") } };
}

export function rowData(values: unknown[]) {
  return { values: values.map(userEnteredCell) };
}

export function updateRowRequest(
  sheet: GoogleSpreadsheetWorksheet,
  rowNumber: number,
  values: unknown[],
) {
  return {
    updateCells: {
      range: {
        sheetId: sheet.sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: 0,
        endColumnIndex: values.length,
      },
      rows: [rowData(values)],
      fields: "userEnteredValue",
    },
  };
}

export function appendRowsRequest(
  sheet: GoogleSpreadsheetWorksheet,
  rows: unknown[][],
) {
  return {
    appendCells: {
      sheetId: sheet.sheetId,
      rows: rows.map(rowData),
      fields: "userEnteredValue",
    },
  };
}

export async function appendClaimRow(
  doc: GoogleSpreadsheet,
  sheet: GoogleSpreadsheetWorksheet,
  values: unknown[],
) {
  const response = await doc.sheetsApi.post(
    `values/${sheet.encodedA1SheetName}!A1:append`,
    {
      searchParams: {
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        includeValuesInResponse: "false",
      },
      json: { values: [values] },
    },
  );
  const payload = (await response.json()) as {
    updates?: { updatedRange?: string };
  };
  const rowNumber = Number(
    payload.updates?.updatedRange?.match(/![A-Z]+([0-9]+):?/)?.[1],
  );
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("Google Sheets did not return the appended operation row");
  }
  return rowNumber;
}

export async function executeAtomicBatch(
  doc: GoogleSpreadsheet,
  requests: unknown[],
) {
  if (requests.length === 0) return;
  await doc.sheetsApi.post(":batchUpdate", {
    json: { requests, includeSpreadsheetInResponse: false },
  });
}

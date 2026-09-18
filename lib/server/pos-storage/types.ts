/** Stable record API while replacing Google Sheets persistence. */
export type PosRow = {
  rowNumber: number;
  get(column: string): unknown;
  set(column: string, value: unknown): void;
  save(): Promise<void>;
};
export type PosWorksheet = {
  sheetId: number;
  title: string;
  headerValues: string[];
  rowCount: number;
  columnCount: number;
  a1SheetName: string;
  encodedA1SheetName: string;
  loadHeaderRow(): Promise<void>;
  setHeaderRow(headers: readonly string[]): Promise<void>;
  resize(size: {rowCount: number; columnCount: number}): Promise<void>;
  getRows(): Promise<PosRow[]>;
  addRows(rows: (Record<string, unknown> | unknown[])[]): Promise<PosRow[]>;
};
export type ApiOptions = {searchParams?: Record<string,string>; json?: unknown};
export type PosDocument = {
  sheetsByTitle: Record<string, PosWorksheet>;
  loadInfo(): Promise<void>;
  addSheet(options: {title: string; headerValues: readonly string[]}): Promise<PosWorksheet>;
  sheetsApi: {
    get(path: string, options?: ApiOptions): Promise<{json(): Promise<unknown>}>;
    post(path: string, options?: ApiOptions): Promise<{json(): Promise<unknown>}>;
  };
};
export type Query = (sql: string, params?: unknown[]) => Promise<{rows: Record<string, unknown>[]} >;

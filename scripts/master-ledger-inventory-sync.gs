const MASTER_LEDGER_SHEET = 'Master_Ledger';
const INVENTORY_CATALOGUE_SHEET = 'Inventory_Catalogue';
const INVENTORY_LOG_SHEET = 'Inventory_Log';
const INVENTORY_CATEGORY = 'бараа';
const SYNC_ID_HEADER = 'Inventory Sync ID';

const MASTER = {
  date: 1,
  bank: 2,
  paidVia: 3,
  supplier: 4,
  description: 5,
  category: 6,
  wing: 7,
  quantity: 8,
  amount: 9,
};

const CATALOGUE = {
  sku: 1,
  name: 2,
  category: 3,
  employeePrice: 4,
  guestPrice: 5,
  preferredSupplier: 6,
  reorderPoint: 7,
  currentStock: 8,
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Inventory')
    .addItem('Sync Master_Ledger бараа', 'processExistingInventoryRows')
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== MASTER_LEDGER_SHEET) return;
  if (e.range.getColumn() !== MASTER.category) return;
  if (!isInventoryCategory_(e.value)) return;

  syncMasterLedgerRow_(sheet, e.range.getRow());
}

function processExistingInventoryRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MASTER_LEDGER_SHEET);
  if (!sheet) throw new Error(`${MASTER_LEDGER_SHEET} not found`);

  let synced = 0;
  let skipped = 0;
  const lastRow = sheet.getLastRow();

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const category = sheet.getRange(rowNumber, MASTER.category).getValue();
    if (!isInventoryCategory_(category)) continue;

    const result = syncMasterLedgerRow_(sheet, rowNumber, true);
    if (result === 'synced') synced += 1;
    if (result === 'skipped') skipped += 1;
  }

  ss.toast(`Inventory sync done. New: ${synced}, already synced: ${skipped}`);
}

function syncMasterLedgerRow_(masterSheet, rowNumber, quiet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inventoryLog = ss.getSheetByName(INVENTORY_LOG_SHEET);
  const catalogue = ss.getSheetByName(INVENTORY_CATALOGUE_SHEET);

  if (!inventoryLog) throw new Error(`${INVENTORY_LOG_SHEET} not found`);
  if (!catalogue) throw new Error(`${INVENTORY_CATALOGUE_SHEET} not found`);

  const syncIdColumn = ensureSyncIdColumn_(masterSheet);
  const existingSyncId = String(masterSheet.getRange(rowNumber, syncIdColumn).getValue() || '').trim();
  if (existingSyncId) {
    if (!quiet) ss.toast('Already synced to Inventory_Log.');
    return 'skipped';
  }

  const row = masterSheet
    .getRange(rowNumber, 1, 1, Math.max(masterSheet.getLastColumn(), syncIdColumn))
    .getValues()[0];
  const itemName = String(row[MASTER.description - 1] || '').trim();
  if (!itemName) return 'skipped';

  const syncId = makeSyncId_(rowNumber, row);
  if (inventoryLogHasTransaction_(inventoryLog, syncId)) {
    masterSheet.getRange(rowNumber, syncIdColumn).setValue(syncId);
    if (!quiet) ss.toast('Already synced to Inventory_Log.');
    return 'skipped';
  }

  const supplier = row[MASTER.supplier - 1] || '';
  const sku = findOrCreateSku_(catalogue, itemName, supplier);
  const paymentSource = [row[MASTER.bank - 1], row[MASTER.paidVia - 1]]
    .filter(Boolean)
    .join(' / ');

  inventoryLog.appendRow([
    syncId,
    row[MASTER.date - 1] || new Date(),
    sku,
    itemName,
    'Орлого',
    row[MASTER.quantity - 1] || 1,
    row[MASTER.wing - 1] || 'Inventory',
    supplier || 'Master_Ledger',
    paymentSource,
    '',
  ]);

  masterSheet.getRange(rowNumber, syncIdColumn).setValue(syncId);
  if (!quiet) ss.toast('Бараа Inventory_Log руу хуулагдлаа.');
  return 'synced';
}

function findOrCreateSku_(catalogue, itemName, supplier) {
  const values = catalogue.getDataRange().getValues();
  const normalizedItem = normalize_(itemName);

  for (let row = 1; row < values.length; row += 1) {
    if (normalize_(values[row][CATALOGUE.name - 1]) === normalizedItem) {
      return values[row][CATALOGUE.sku - 1];
    }
  }

  catalogue.appendRow([
    '',
    itemName,
    'Бараа',
    '',
    '',
    supplier || '',
    '',
    '',
  ]);

  SpreadsheetApp.flush();
  const lastRow = catalogue.getLastRow();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sku = String(catalogue.getRange(lastRow, CATALOGUE.sku).getDisplayValue() || '').trim();
    if (sku) return sku;
    Utilities.sleep(500);
  }

  throw new Error(`SKU was not generated for "${itemName}". Check Inventory_Catalogue SKU formula.`);
}

function ensureSyncIdColumn_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const existingIndex = headers.indexOf(SYNC_ID_HEADER);
  if (existingIndex !== -1) return existingIndex + 1;

  const newColumn = headers.length + 1;
  sheet.getRange(1, newColumn).setValue(SYNC_ID_HEADER);
  return newColumn;
}

function inventoryLogHasTransaction_(inventoryLog, syncId) {
  const lastRow = inventoryLog.getLastRow();
  if (lastRow < 2) return false;

  const transactionIds = inventoryLog
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .flat()
    .map(value => String(value || '').trim());

  return transactionIds.indexOf(syncId) !== -1;
}

function makeSyncId_(rowNumber, row) {
  const raw = [
    rowNumber,
    row[MASTER.date - 1],
    row[MASTER.supplier - 1],
    row[MASTER.description - 1],
    row[MASTER.quantity - 1],
    row[MASTER.amount - 1],
  ].join('|');

  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, raw)
    .map(byte => (`0${(byte < 0 ? byte + 256 : byte).toString(16)}`).slice(-2))
    .join('')
    .slice(0, 10)
    .toUpperCase();

  return `ML-${rowNumber}-${digest}`;
}

function isInventoryCategory_(value) {
  return normalize_(value) === INVENTORY_CATEGORY;
}

function normalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

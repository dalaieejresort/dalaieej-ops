import 'server-only';
import { createPosDocument, type PosWorksheet } from './pos-storage';
import { isUnlimitedInventoryItem } from '@/lib/pos/inventory';
import { getUlaanbaatarBusinessDate } from '@/lib/pos/business-date';
import { operationFingerprint } from './operation-controls';

const SKU = 'SKU (Барааны код)';
const NAME = 'Item Name (Барааны нэр)';
const CATEGORY = 'Category (Ангилал)';
const GUEST = 'Guest Price (Амрагчдын үнэ)';
const STAFF = 'Employee Price (Ажчилчдын үнэ)';
const STOCK = 'Current Stock (Үлдэгдэл)';
const OP_HEADERS = ['request_id','action','fingerprint','sku','quantity','reason','actor','created_at'];
const norm = (v: unknown) => String(v ?? '').normalize('NFKC').trim().toUpperCase();
export class ProductInputError extends Error {}
function text(v: unknown, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max || /[\u0000-\u001f]/.test(v)) throw new ProductInputError('Талбарыг зөв бөглөнө үү. / Invalid or missing field.');
  return v.trim();
}
function amount(v: unknown, max: number, positive = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (positive && v === 0) || v > max || Math.abs(v * 1000 - Math.round(v * 1000)) > 0.00001) throw new ProductInputError('Тоо, үнийн дүн буруу байна. / Invalid quantity or price.');
  return v;
}
async function context() {
  const doc = createPosDocument(); await doc.loadInfo();
  const catalogue = doc.sheetsByTitle.Inventory_Catalogue ?? doc.sheetsByTitle.Inventory_Catalog;
  if (!catalogue) throw new Error('Catalogue unavailable');
  await catalogue.loadHeaderRow();
  if (![SKU, NAME, CATEGORY, GUEST, STAFF, STOCK].every(h => catalogue.headerValues.includes(h))) throw new Error('Catalogue columns unavailable');
  return { doc, catalogue, rows: await catalogue.getRows() };
}
export async function listProducts() {
  const { rows } = await context();
  return rows.map(row => {
    const product = { sku: String(row.get(SKU) ?? ''), name: String(row.get(NAME) ?? ''), category: String(row.get(CATEGORY) ?? ''), guestPrice: Number(row.get(GUEST)) || 0, staffPrice: Number(row.get(STAFF)) || 0, stock: Number(row.get(STOCK)) || 0 };
    return { ...product, tracked: !isUnlimitedInventoryItem(product) };
  });
}
async function ensureColumns(sheet: PosWorksheet, columns: string[]) {
  await sheet.loadHeaderRow();
  const headers = [...sheet.headerValues, ...columns.filter(h => !sheet.headerValues.includes(h))];
  if (headers.length !== sheet.headerValues.length) {
    if (headers.length > sheet.columnCount) await sheet.resize({rowCount:sheet.rowCount,columnCount:headers.length});
    await sheet.setHeaderRow(headers);
  }
}
export async function saveProductOperation(value: unknown, actor: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductInputError('Invalid request');
  const input = value as Record<string, unknown>;
  const requestId = text(input.clientRequestId, 128);
  if (input.action !== 'create' && input.action !== 'receive') throw new ProductInputError('Invalid action');
  const action = input.action;
  const payload = action === 'create'
    ? { action: 'create' as const, name: text(input.name, 200), category: text(input.category, 100), guestPrice: amount(input.guestPrice, 1e9), staffPrice: amount(input.staffPrice, 1e9) }
    : { action: 'receive' as const, sku: norm(text(input.sku, 100)), quantity: amount(input.quantity, 1e6, true), reason: text(input.reason, 500), kind: input.kind === 'opening' ? 'opening' : input.kind === 'delivery' ? 'delivery' : '' };
  if (payload.action === 'create' && !payload.guestPrice && !payload.staffPrice) throw new ProductInputError('Борлуулах үнийг оруулна уу. / Enter a selling price.');
  if (payload.action === 'receive' && !payload.kind) throw new ProductInputError('Choose opening stock or delivery');
  const fingerprint = operationFingerprint(payload);
  const { doc, catalogue, rows } = await context();
  const ops = doc.sheetsByTitle.Product_Operations ?? await doc.addSheet({title:'Product_Operations',headerValues:OP_HEADERS});
  const prior = (await ops.getRows()).find(r => r.get('request_id') === requestId);
  if (prior) {
    if (prior.get('fingerprint') !== fingerprint) throw new ProductInputError('This request was already used for different details. Reload before trying again.');
    return { sku: String(prior.get('sku')), duplicateRequest: true };
  }
  let sku: string;
  if (payload.action === 'create') {
    if (rows.some(r => norm(r.get(NAME)) === norm(payload.name))) throw new ProductInputError('Ижил нэртэй бараа байна. / A product with this name already exists.');
    const used = new Set(rows.map(r => norm(r.get(SKU))));
    if (used.size !== rows.length || used.has('')) throw new ProductInputError('Resolve catalogue SKU conflicts before adding a product.');
    const next = Math.max(0, ...[...used].map(s => /^INV-\d+$/.test(s) ? Number(s.slice(4)) : 0)) + 1;
    sku = `INV-${String(next).padStart(4, '0')}`;
    await catalogue.addRows([{[SKU]:sku,[NAME]:payload.name,[CATEGORY]:payload.category,[GUEST]:payload.guestPrice,[STAFF]:payload.staffPrice,[STOCK]:0}]);
  } else {
    sku = payload.sku;
    const matches = rows.filter(r => norm(r.get(SKU)) === sku);
    if (matches.length !== 1) throw new ProductInputError('Choose one valid catalogue product.');
    const product = matches[0];
    if (isUnlimitedInventoryItem({sku,name:String(product.get(NAME)),category:String(product.get(CATEGORY))})) throw new ProductInputError('Хоол, үйлчилгээний үлдэгдлийг энд тоолохгүй. / This item does not track stock.');
    const inventory = doc.sheetsByTitle.Inventory_Log;
    if (!inventory) throw new Error('Inventory log unavailable');
    await ensureColumns(inventory, ['Transaction ID','Timestamp',SKU,'Item Description','Type (Хөдөлгөөн)','Quantity (Тоо)','Location (Байршил)','Handled By','Business Date','Adjustment Reason','Client Request ID','Operation Status','Request Fingerprint','Operation Updated At']);
    if (payload.kind === 'opening' && (await inventory.getRows()).some(r => norm(r.get(SKU)) === sku)) throw new ProductInputError('Эхний үлдэгдэл бүртгэгдсэн. Орлого эсвэл тооллогын тохируулга ашиглана уу. / This product already has stock movements.');
    const now = new Date();
    await inventory.addRows([{'Transaction ID':`STK-${requestId}`,Timestamp:now.toLocaleString('en-US',{timeZone:'Asia/Ulaanbaatar'}),[SKU]:sku,'Item Description':String(product.get(NAME)),'Type (Хөдөлгөөн)':'Орлого','Quantity (Тоо)':payload.quantity,'Location (Байршил)':'Front Desk','Handled By':actor,'Business Date':getUlaanbaatarBusinessDate(now),'Adjustment Reason':`${payload.kind}: ${payload.reason}`,'Client Request ID':requestId,'Operation Status':'complete','Request Fingerprint':fingerprint,'Operation Updated At':now.toISOString()}]);
  }
  await ops.addRows([{request_id:requestId,action,fingerprint,sku,quantity:payload.action==='receive'?payload.quantity:'',reason:payload.action==='receive'?payload.reason:'New product',actor,created_at:new Date().toISOString()}]);
  return {sku,duplicateRequest:false};
}

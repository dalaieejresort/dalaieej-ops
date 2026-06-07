import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

// 1. Authenticate the "Robot" User
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  // This replace() function is critical. Vercel environment variables sometimes 
  // break the newline characters in Google's private keys. This fixes it.
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

// ==========================================
// GET: Fetch the Catalog for the iPad Screen
// ==========================================
export async function GET() {
  try {
    await doc.loadInfo(); 
    // Pull from Tab 3 (Table A)
    const catalogSheet = doc.sheetsByTitle['Inventory_Catalog'];
    const rows = await catalogSheet.getRows();

    // Clean up the Google Sheets data into a simple JSON array for your React frontend
    const products = rows.map(row => ({
      sku: row.get('SKU (Барааны код)'),
      name: row.get('Item Name (Барааны нэр)'),
      price: Number(row.get('Unit Cost (Нэгж үнэ ₮)')),
      stock: Number(row.get('Current Stock (Үлдэгдэл)'))
    }));

    // Filter out any empty rows just in case
    const validProducts = products.filter(p => p.sku);

    return NextResponse.json(validProducts);
  } catch (error) {
    console.error("GET Error:", error);
    return NextResponse.json({ error: 'Failed to fetch catalog' }, { status: 500 });
  }
}

// ==========================================
// POST: Push confirmed orders to the Ledger
// ==========================================
export async function POST(request) {
  try {
    const body = await request.json();
    const { items, method, room, staffName } = body;

    await doc.loadInfo();
    // Push to Tab 4 (Table B)
    const logSheet = doc.sheetsByTitle['Inventory_Log']; 

    // Lock the timestamp to Ulaanbaatar time regardless of where Vercel's servers are
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Ulaanbaatar" });
    const transactionId = `TXN-${Math.floor(100000 + Math.random() * 900000)}`;

    // Map every item in the shopping cart to its own row for the log
    const newRows = items.map(item => {
      // Using an array guarantees the data perfectly matches your 10 columns 
      // from left to right, ignoring header typos.
      return [
        transactionId,             // A: Transaction ID
        timestamp,                 // B: Timestamp
        item.sku,                  // C: SKU
        item.name,                 // D: Item Description
        "Зарлага",                 // E: Type (Strictly Outflow for POS sales)
        item.qty,                  // F: Quantity
        "Front Desk",              // G: Location (Can be dynamic later)
        staffName || "Staff",      // H: Handled By
        method,                    // I: Payment Method (Qpay/Card/Cash/Room)
        room || ""                 // J: Room Number (If applicable)
      ];
    });

    // Fire the data into Google Sheets
    await logSheet.addRows(newRows);

    return NextResponse.json({ success: true, message: `Logged ${newRows.length} items.` });
  } catch (error) {
    console.error("POST Error:", error);
    return NextResponse.json({ error: 'Failed to log transaction' }, { status: 500 });
  }
}
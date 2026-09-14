import { timingSafeEqual } from "node:crypto";
import { findReceiptBankPayments } from "@/lib/receipt-payments/gmail";
import { matchPaidVia, type ReceiptPaymentQuery } from "@/lib/receipt-payments/paid-via-match";

export const maxDuration = 60;

export async function POST(request: Request) {
  const expected = process.env.RECEIPT_MATCH_SECRET || "";
  const supplied = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const raw = await request.text();
    if (raw.length > 12000) return Response.json({ error: "Request too large" }, { status: 413 });
    const q = JSON.parse(raw) as ReceiptPaymentQuery;
    if (!Number.isFinite(q.amount) || q.amount <= 0 || q.amount > 1e12 ||
        !/^[A-Z]{3}$/.test(q.currency) || typeof q.supplier !== "string" ||
        typeof q.reference !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(q.date) ||
        !Number.isFinite(Date.parse(q.date))) {
      return Response.json({ error: "Invalid receipt query" }, { status: 400 });
    }
    const candidates = await findReceiptBankPayments(q);
    return Response.json(matchPaidVia(q, candidates), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && ["receipt_mailbox_not_connected", "receipt_setup_required"].includes(error.message)
      ? error.message : "bank_lookup_unavailable";
    // No mailbox contents, tokens or raw upstream errors in logs/responses.
    return Response.json({ status: "unavailable", code }, { status: 503 });
  }
}

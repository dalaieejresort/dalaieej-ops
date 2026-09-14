import type { Metadata } from "next";
import { requirePageSession } from "@/lib/server/auth";
import { CONNECTION_PAGE, RECEIPT_MAILBOX, receiptSetup } from "@/lib/receipt-payments/config";
import { getReceiptConnection } from "@/lib/receipt-payments/database";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Telegram receipts · Gmail connection" };

export default async function ReceiptConnectionPage({ searchParams }: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requirePageSession(CONNECTION_PAGE, "owner");
  const { status } = await searchParams;
  const setup = receiptSetup();
  const ready = Object.values(setup).every(Boolean);
  let connected = false;
  let storageError = false;
  if (setup.database) {
    try { connected = Boolean(await getReceiptConnection()); } catch { storageError = true; }
  }
  const messages: Record<string, string> = {
    connected: "Gmail connected. You can return to Telegram; no routine visits to this page are needed.",
    "wrong-mailbox": `That Google account was not saved. Please choose ${RECEIPT_MAILBOX}.`,
    "authorization-error": "The connection was not completed. Please try again.",
    "setup-required": "The separate receipt integration needs its server configuration before Gmail can be connected.",
  };
  return <main className="mx-auto max-w-2xl px-6 py-12">
    <p className="text-sm text-slate-500">2027 season · Telegram + Google Sheets</p>
    <h1 className="mt-3 text-3xl font-semibold">Connect receipt payment emails</h1>
    <p className="mt-5">Allow Telegram expense receipts to look for matching Khan Bank ••••9325 emails and fill Paid via in the Master Ledger.</p>
    <p className="mt-4">This connection is separate from DGB / Global / Batsarai reconciliation. It does not import bank transactions or update the 2026 SQLite database.</p>
    <section className="mt-8 rounded-xl border border-slate-200 p-6" aria-label="Gmail connection">
      <h2 className="text-lg font-semibold">{RECEIPT_MAILBOX}</h2>
      <p className="mt-2">{connected ? "Connected" : "Not connected"} · Gmail read-only access</p>
      {status && messages[status] && <p role="status" className="mt-4">{messages[status]}</p>}
      {(!ready || storageError) && <p className="mt-4" role="status">Server setup is still needed for this separate connection. Existing reconciliation credentials will not be used.</p>}
      {ready && !storageError && <a className="mt-6 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white" href="/api/receipt-payments/gmail/connect">{connected ? "Reconnect Gmail" : "Connect Gmail"}</a>}
    </section>
    <p className="mt-6 text-sm text-slate-600">Google grants read access to the mailbox. This integration only searches Khan Bank transfer-receipt emails for matching payments. Ambiguous or missing matches do not receive an automatic bank label.</p>
  </main>;
}

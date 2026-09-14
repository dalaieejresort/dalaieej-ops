import type { Metadata } from "next";
import ReceiptShell from "../ReceiptShell";
import styles from "../ReceiptPayments.module.css";
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
  return <ReceiptShell active="connect" title="Receipt payment emails">
    <p className={styles.metadata}>2027 season · Telegram + Google Sheets</p>
    <p>Match Telegram expense receipts to Khan Bank ••••9325 emails and fill “Paid via” in the Master Ledger.</p>
    <section className={styles.connection} aria-label="Gmail connection">
      <h2 className={styles.sectionLabel}>Gmail connection</h2>
      <dl>
        <div className={styles.detailRow}>
          <dt>Mailbox</dt><dd>{RECEIPT_MAILBOX}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Status</dt>
          <dd className={connected ? styles.connected : undefined}>
            {storageError ? "Unable to check connection" : connected ? "Connected" : "Not connected"}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt>Access</dt><dd>Gmail · Read-only</dd>
        </div>
      </dl>
      {status && messages[status] && (status !== "connected" || connected) && (
        <div role="status" className={`${styles.notice} ${status === "connected" ? styles.connected : styles.error}`}>
          <p>{messages[status]}</p>
        </div>
      )}
      {(!ready || storageError) && <p className={styles.notice} role="status">This connection is temporarily unavailable. Please contact the operator before reconnecting.</p>}
      {ready && !storageError && <div className={styles.actions}>
        <a className={styles.primary} href="/api/receipt-payments/gmail/connect">{connected ? "Reconnect Gmail" : "Connect Gmail"}</a>
      </div>}
    </section>
    <h2>Payment matching</h2>
    <p>Google grants read access to the mailbox. This integration only searches Khan Bank transfer-receipt emails for matching payments. Ambiguous or missing matches do not receive an automatic bank label.</p>
    <p className={styles.metadata}>This receipt connection is separate from DGB / Global / Batsarai reconciliation.</p>
  </ReceiptShell>;
}

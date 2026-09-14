import type { Metadata } from "next";
import Link from "next/link";
import ReceiptShell from "./ReceiptShell";
import styles from "./ReceiptPayments.module.css";

export const metadata: Metadata = {
  title: "Dalai Eej Receipts 2027",
  description: "Receipt processing and read-only bank-email matching for Dalai Eej Resort's 2027 ledger.",
};

export default function ReceiptInformationPage() {
  return <ReceiptShell active="overview" title="Dalai Eej Receipts 2027">
      <p className={styles.metadata}>DALAI EEJ RESORT · 2027 SEASON</p>
      <p>An owner-operated receipt tool that helps record Telegram receipts in a Google Sheets ledger and identify how an expense was paid.</p>
      <h2>How it works</h2>
      <ol>
        <li>An authorized user sends a receipt to the resort’s Telegram bot. OCR extracts the receipt details.</li>
        <li>With the mailbox owner’s permission, the payment lookup searches matching Khan Bank transfer-receipt emails in the connected Gmail account.</li>
        <li>A single qualifying match can supply the ledger’s “Paid via” label and supporting match details. Missing or ambiguous matches are left for review.</li>
      </ol>
      <h2>Read-only Gmail access</h2>
      <p>Google’s permission allows the app to read mailbox messages. The application limits its searches to relevant Khan Bank transfer receipts. It cannot send, edit, or delete Gmail messages, and it cannot access a bank account or move money.</p>
      <p>Gmail authorization is restricted to the designated resort mailbox and requires an owner sign-in. These public pages do not display receipts, bank emails, or ledger records. The 2027 payment lookup is separate from the resort’s 2026 reconciliation tool.</p>
      <nav aria-label="Receipt tool links" className={styles.links}>
        <Link href="/receipt-payments/connect" prefetch={false}>Owner sign-in &amp; Gmail connection</Link>
        <Link href="/receipt-payments/privacy">Privacy policy</Link>
      </nav>
      <p>Operated by Dalai Eej Resort. Questions? <a href="mailto:dalaieejcamp@gmail.com">dalaieejcamp@gmail.com</a>.</p>
    </ReceiptShell>;
}

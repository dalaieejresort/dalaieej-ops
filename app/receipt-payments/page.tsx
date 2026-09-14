import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dalai Eej Receipts 2027",
  description: "Receipt processing and read-only bank-email matching for Dalai Eej Resort's 2027 ledger.",
};

export default function ReceiptInformationPage() {
  return <main lang="en" className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
    <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10">
      <p className="text-sm font-semibold tracking-wide text-emerald-800">DALAI EEJ RESORT · 2027 SEASON</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Dalai Eej Receipts 2027</h1>
      <p className="mt-6 text-lg leading-8 text-slate-700">An owner-operated receipt tool that helps record Telegram receipts in a Google Sheets ledger and identify how an expense was paid.</p>
      <h2 className="mt-8 text-xl font-semibold">How it works</h2>
      <ol className="mt-4 list-decimal space-y-3 pl-6 leading-7 text-slate-700">
        <li>An authorized user sends a receipt to the resort’s Telegram bot. OCR extracts the receipt details.</li>
        <li>With the mailbox owner’s permission, the payment lookup searches matching Khan Bank transfer-receipt emails in the connected Gmail account.</li>
        <li>A single qualifying match can supply the ledger’s “Paid via” label and supporting match details. Missing or ambiguous matches are left for review.</li>
      </ol>
      <h2 className="mt-8 text-xl font-semibold">Read-only Gmail access</h2>
      <p className="mt-3 leading-7 text-slate-700">Google’s permission allows the app to read mailbox messages. The application limits its searches to relevant Khan Bank transfer receipts. It cannot send, edit, or delete Gmail messages, and it cannot access a bank account or move money.</p>
      <p className="mt-4 leading-7 text-slate-700">Gmail authorization is restricted to the designated resort mailbox and requires an owner sign-in. These public pages do not display receipts, bank emails, or ledger records. The 2027 payment lookup is separate from the resort’s 2026 reconciliation tool.</p>
      <nav aria-label="Receipt tool links" className="mt-8 flex flex-wrap gap-5 border-t border-slate-200 pt-6">
        <Link href="/receipt-payments/connect" prefetch={false} className="font-semibold text-emerald-800 underline underline-offset-4">Owner sign-in &amp; Gmail connection</Link>
        <Link href="/receipt-payments/privacy" className="font-semibold text-emerald-800 underline underline-offset-4">Privacy policy</Link>
      </nav>
      <p className="mt-6 text-sm leading-6 text-slate-600">Operated by Dalai Eej Resort. Questions? <a href="mailto:dalaieejcamp@gmail.com" className="underline underline-offset-4">dalaieejcamp@gmail.com</a>.</p>
    </article>
  </main>;
}

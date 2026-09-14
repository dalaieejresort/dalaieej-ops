import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy · Dalai Eej Receipts 2027",
  description: "How Dalai Eej Receipts 2027 accesses, uses, stores, and shares Gmail payment-matching data.",
};

export default function ReceiptPrivacyPage() {
  return <main lang="en" className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-20">
    <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-4 [&_p]:leading-7 [&_p]:text-slate-700 [&_a]:text-emerald-800 [&_a]:underline [&_a]:underline-offset-4">
      <Link href="/receipt-payments">Dalai Eej Receipts 2027</Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Privacy policy</h1>
      <p>Effective date: 8 September 2026</p>
      <p>Dalai Eej Resort operates Dalai Eej Receipts 2027. This notice covers its Gmail payment lookup and the resulting match information used in the Telegram-to-Google-Sheets receipt workflow. It does not cover the separate 2026 reconciliation system or the resort’s booking website.</p>

      <h2>Information accessed and why</h2>
      <p>After the mailbox owner authorizes Gmail read-only access, the tool reads the mailbox email address to confirm the correct account. It searches Khan Bank transfer-receipt emails using receipt amounts and dates, and reads candidate message headers and bodies to verify the sender and compare payment details.</p>
      <p>Processed information can include email identifiers, sender and subject, authentication headers, account details present in the email, payment amount and currency, transaction date, recipient name, payment reference, and journal number. The matching result uses an account suffix rather than a full account number.</p>
      <p>This information is used to find a qualifying payment for a receipt and provide a “Paid via” label with evidence for the resort’s 2027 Master Ledger. Missing or ambiguous matches do not automatically assign a bank label.</p>

      <h2>Permission and limits</h2>
      <p>The Google permission is Gmail read-only. It technically permits reading mailbox messages; the application’s queries restrict use to relevant bank transfer receipts. The tool does not send, modify, or delete Gmail messages and does not authorize bank payments. Only the designated resort mailbox can be connected through the owner-only authorization page.</p>

      <h2>Storage and retention</h2>
      <p>The dedicated connection database stores the mailbox address, connection time, and an encrypted OAuth refresh token so the tool can perform later lookups without repeated sign-in. Credentials remain stored until replaced or removed by the operator. A previous mailbox credential may be retained as an inactive record, but is not used as a fallback.</p>
      <p>Full bank-email bodies are processed in memory during lookup and are not saved in this tool’s database. The Telegram bot can save match evidence in the resort’s Google Sheets ledger, including the bank and account suffix, amount, currency, date, recipient, journal number, and a link to the source Gmail message. Ledger records remain until the resort removes them under its record-retention process. Revoking Gmail access does not automatically delete existing ledger entries or source emails.</p>

      <h2>Service providers and sharing</h2>
      <p>Google provides Gmail access and Google Sheets storage. Vercel hosts the application and receipt bot, and Neon stores the encrypted connection record. These services process the information needed to deliver the workflow. Telegram handles receipt uploads and bot communications. Access to saved match evidence follows the resort’s ledger-sharing permissions.</p>
      <p>The Gmail lookup does not send bank-email contents to AI models; matching uses programmed parsing and comparison rules. OCR of user-uploaded receipts is a separate step. Gmail data is not sold or used for advertising, credit decisions, or training general-purpose AI models.</p>
      <p>Dalai Eej Receipts 2027 uses and transfers information obtained from Google APIs in accordance with the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>

      <h2>Security and technical information</h2>
      <p>The application uses HTTPS, owner sign-in for Gmail authorization, authenticated bot requests, and encryption for stored refresh tokens. The public information pages do not expose mailbox or ledger contents. Essential cookies support owner sign-in and OAuth request validation. Hosting providers may process technical request information, such as IP addresses and error metadata, to operate and secure the service.</p>

      <h2>Control, revocation, and deletion requests</h2>
      <p>You can stop future Gmail access by removing this app’s connection in your <a href="https://myaccount.google.com/connections">Google Account connections</a>. To request deletion of stored connection credentials or review, correction, or deletion of match evidence, contact <a href="mailto:dalaieejcamp@gmail.com">dalaieejcamp@gmail.com</a>. Please identify the relevant account or record without sending passwords or access tokens. The operator will verify the request and explain any applicable record-retention requirements.</p>

      <h2>Contact and updates</h2>
      <p>For privacy questions, contact Dalai Eej Resort at <a href="mailto:dalaieejcamp@gmail.com">dalaieejcamp@gmail.com</a>. Updates to this notice will be published on this page with a revised effective date.</p>
    </article>
  </main>;
}

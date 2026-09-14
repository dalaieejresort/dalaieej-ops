import "server-only";
import { getReceiptConnection } from "./database";
import { receiptOAuthClient } from "./oauth";
import { decryptReceiptToken } from "./token-crypto";
import { RECEIPT_MAILBOX } from "./config";
import { parseKhanBankEmail } from "@/lib/reconciliation/khan-bank-email";
import type { BankPaymentCandidate, ReceiptPaymentQuery } from "./paid-via-match";
const KHAN_QUERY = 'from:noreply@khanbank.com subject:"Шилжүүлгийн баримт/Transaction receipt" newer_than:2y -in:spam -in:trash';
type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
};

function header(part: GmailPart | undefined, name: string) {
  return (
    part?.headers?.find(
      (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function findHtml(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const html = findHtml(child);
    if (html) return html;
  }
  return "";
}

function khanTimestamp(value: string | null) {
  const match = value?.match(
    /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
    : null;
}

export async function findReceiptBankPayments(query: ReceiptPaymentQuery): Promise<BankPaymentCandidate[]> {
  const connection = await getReceiptConnection();
  if (connection?.emailAddress.toLowerCase() !== RECEIPT_MAILBOX) {
    throw new Error("receipt_mailbox_not_connected");
  }
  const client = receiptOAuthClient();
  client.setCredentials({ refresh_token: decryptReceiptToken(connection.encryptedRefreshToken) });
  const center = Date.parse(query.date);
  const after = new Date(center - 31 * 86400000).toISOString().slice(0, 10).replaceAll("-", "/");
  const before = new Date(center + 32 * 86400000).toISOString().slice(0, 10).replaceAll("-", "/");
  const amount = query.amount.toFixed(query.currency === "MNT" ? 0 : 2);
  const grouped = Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const params = new URLSearchParams({
    q: `${KHAN_QUERY} after:${after} before:${before} {"${amount}" "${grouped}"}`,
    maxResults: "51",
  });
  const listed = await client.request<{ messages?: { id: string }[]; nextPageToken?: string }>({
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    timeout: 8000,
  });
  if (listed.data.nextPageToken || (listed.data.messages?.length ?? 0) > 50) {
    throw new Error("too_many_payment_candidates");
  }
  const candidates: BankPaymentCandidate[] = [];
  const messages = listed.data.messages ?? [];
  for (let i = 0; i < messages.length; i += 5) {
    const batch = await Promise.all(messages.slice(i, i + 5).map(async ({ id }) => {
      const response = await client.request<GmailMessage>({
        url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
        timeout: 8000,
      });
      const message = response.data;
      const parsed = parseKhanBankEmail({ sender: header(message.payload, "From"),
        subject: header(message.payload, "Subject"), html: findHtml(message.payload),
        authenticationResults: header(message.payload, "Authentication-Results") });
      if (parsed.authenticityStatus !== "verified" || parsed.parseStatus !== "parsed" ||
          parsed.fromAccountSuffix !== "9325" || parsed.amountMinor === null) return null;
      return { id, institution: "Khan Bank", suffix: parsed.fromAccountSuffix,
        amount: parsed.amountMinor / 10 ** parsed.minorUnitDigits,
        currency: parsed.currency || "", supplier: parsed.toName || "",
        reference: parsed.description || "", date: khanTimestamp(parsed.transactionAt) || "",
        journal: parsed.journalNo || "", evidenceUrl: `https://mail.google.com/mail/#all/${id}` };
    }));
    for (const item of batch) if (item) candidates.push(item);
  }
  return candidates;
}

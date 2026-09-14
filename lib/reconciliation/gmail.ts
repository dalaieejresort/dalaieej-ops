import "server-only";

import { OAuth2Client } from "google-auth-library";
import {
  finishGmailSyncRun,
  deleteGmailConnection,
  getStoredGmailConnection,
  hasBankEmailEvent,
  insertBankEmailEvent,
  saveGmailConnection,
  startGmailSyncRun,
} from "@/lib/reconciliation/database";
import { parseKhanBankEmail } from "@/lib/reconciliation/khan-bank-email";
import { decryptToken, encryptToken } from "@/lib/reconciliation/token-crypto";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
];
const KHAN_QUERY =
  'from:noreply@khanbank.com subject:"Шилжүүлгийн баримт/Transaction receipt" newer_than:2y -in:spam -in:trash';

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

function requiredOAuthConfig() {
  const clientId = process.env.RECONCILIATION_GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.RECONCILIATION_GMAIL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth is not configured for reconciliation");
  }
  return { clientId, clientSecret };
}

export function gmailRedirectUri(requestUrl: string) {
  const configured = process.env.RECONCILIATION_GMAIL_REDIRECT_URI?.trim();
  if (configured) return configured;
  const request = new URL(requestUrl);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Gmail redirect URL is not configured");
  }
  return new URL("/api/reconciliation/gmail/callback", request.origin).toString();
}

function oauthClient(redirectUri: string) {
  const config = requiredOAuthConfig();
  return new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
}

export function createGmailAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
}) {
  return oauthClient(input.redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state: input.state,
  });
}

export async function completeGmailAuthorization(input: {
  redirectUri: string;
  code: string;
}) {
  const client = oauthClient(input.redirectUri);
  const { tokens } = await client.getToken(input.code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a reusable Gmail authorization");
  }
  client.setCredentials(tokens);
  const profile = await client.request<{ emailAddress?: string }>({
    url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  });
  const emailAddress = profile.data.emailAddress?.trim().toLowerCase();
  if (!emailAddress) throw new Error("Gmail account address was not returned");

  await saveGmailConnection({
    emailAddress,
    encryptedRefreshToken: encryptToken(tokens.refresh_token),
    scopes: tokens.scope ?? GMAIL_SCOPES.join(" "),
  });
  return emailAddress;
}

export async function disconnectGmailAuthorization() {
  const connection = await getStoredGmailConnection();
  if (!connection) return null;
  const redirectUri =
    process.env.RECONCILIATION_GMAIL_REDIRECT_URI?.trim() ||
    "http://localhost:3000/api/reconciliation/gmail/callback";
  const client = oauthClient(redirectUri);
  try {
    await client.revokeToken(decryptToken(connection.encryptedRefreshToken));
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status !== 400) throw error;
  }
  await deleteGmailConnection();
  return connection.emailAddress;
}

function header(part: GmailPart | undefined, name: string) {
  return (
    part?.headers?.find(
      (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function senderAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
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

async function listMessageIds(client: OAuth2Client, limit?: number) {
  const ids: Array<{ id: string; threadId?: string }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const remaining = limit ? limit - ids.length : 100;
    if (remaining <= 0) break;
    const params = new URLSearchParams({
      q: KHAN_QUERY,
      maxResults: String(Math.min(remaining, 100)),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await client.request<{
      messages?: Array<{ id?: string; threadId?: string }>;
      nextPageToken?: string;
    }>({
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    });
    for (const message of response.data.messages ?? []) {
      if (message.id) ids.push({ id: message.id, threadId: message.threadId });
      if (limit && ids.length >= limit) break;
    }
    pageToken = response.data.nextPageToken;
    if (!pageToken || (limit && ids.length >= limit)) break;
  }
  return ids;
}

async function readMessage(client: OAuth2Client, id: string) {
  const response = await client.request<GmailMessage>({
    url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
  });
  return response.data;
}


export async function syncKhanBankGmail(input?: { limit?: number }) {
  const connection = await getStoredGmailConnection();
  if (!connection) throw new Error("Gmail is not connected");
  const redirectUri =
    process.env.RECONCILIATION_GMAIL_REDIRECT_URI?.trim() ||
    "http://localhost:3000/api/reconciliation/gmail/callback";
  const client = oauthClient(redirectUri);
  client.setCredentials({
    refresh_token: decryptToken(connection.encryptedRefreshToken),
  });

  const runId = await startGmailSyncRun();
  let found = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const messages = await listMessageIds(client, input?.limit);
    found = messages.length;
    for (const candidate of messages) {
      if (await hasBankEmailEvent("gmail", candidate.id)) {
        skipped += 1;
        continue;
      }
      try {
        const message = await readMessage(client, candidate.id);
        const sender = header(message.payload, "From");
        const subject = header(message.payload, "Subject");
        const authenticationResults = header(
          message.payload,
          "Authentication-Results",
        );
        const parsed = parseKhanBankEmail({
          sender,
          subject,
          html: findHtml(message.payload),
          authenticationResults,
        });
        const receivedAt = message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : new Date().toISOString();
        const inserted = await insertBankEmailEvent({
          provider: "gmail",
          providerMessageId: candidate.id,
          providerThreadId: message.threadId ?? candidate.threadId ?? null,
          internetMessageId: header(message.payload, "Message-ID") || null,
          senderAddress: senderAddress(sender),
          subject,
          receivedAt,
          institution: "Khan Bank",
          transactionAt: khanTimestamp(parsed.transactionAt),
          journalNo: parsed.journalNo,
          direction: parsed.direction,
          fromAccountSuffix: parsed.fromAccountSuffix,
          toAccountSuffix: parsed.toAccountSuffix,
          destinationBank: parsed.destinationBank,
          counterpartyText: parsed.toName,
          description: parsed.description,
          amountMinor: parsed.amountMinor,
          currency: parsed.currency,
          minorUnitDigits: parsed.minorUnitDigits,
          authenticityStatus: parsed.authenticityStatus,
          parseStatus: parsed.parseStatus,
          rawMetadata: {
            provider: "gmail",
            parser: "khan-transfer-receipt-v1",
            authenticationChecked: Boolean(authenticationResults),
          },
        });
        if (inserted) imported += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }

    const status = failed === 0 ? "completed" : "partially_completed";
    await finishGmailSyncRun({
      id: runId,
      status,
      found,
      imported,
      skipped,
      failed,
    });
    return { found, imported, skipped, failed };
  } catch (error) {
    await finishGmailSyncRun({
      id: runId,
      status: "failed",
      found,
      imported,
      skipped,
      failed,
      errorMessage: error instanceof Error ? error.message : "Gmail sync failed",
    });
    throw error;
  }
}

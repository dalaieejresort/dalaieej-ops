import "server-only";
import { OAuth2Client } from "google-auth-library";
import { receiptRedirectUri, RECEIPT_MAILBOX } from "./config";
import { saveReceiptConnection } from "./database";
import { encryptReceiptToken } from "./token-crypto";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export function receiptOAuthClient() {
  const id = process.env.RECEIPT_GMAIL_CLIENT_ID?.trim();
  const secret = process.env.RECEIPT_GMAIL_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("receipt_setup_required");
  return new OAuth2Client(id, secret, receiptRedirectUri());
}

export function receiptAuthorizationUrl(state: string) {
  return receiptOAuthClient().generateAuthUrl({
    access_type: "offline", prompt: "consent", include_granted_scopes: false,
    scope: [SCOPE], login_hint: RECEIPT_MAILBOX, state,
  });
}

export async function completeReceiptAuthorization(code: string) {
  const client = receiptOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(SCOPE)) {
    throw new Error("authorization_error");
  }
  client.setCredentials(tokens);
  const profile = await client.request<{ emailAddress?: string }>({
    url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", timeout: 8000,
  });
  const email = profile.data.emailAddress?.trim().toLowerCase();
  // Reject the wrong Google account before any credential is persisted.
  if (email !== RECEIPT_MAILBOX) throw new Error("wrong_mailbox");
  await saveReceiptConnection(email, encryptReceiptToken(tokens.refresh_token));
}

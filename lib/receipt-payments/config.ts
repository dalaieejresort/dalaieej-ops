export const RECEIPT_MAILBOX = "dalaieejcamp@gmail.com";
export const CONNECTION_PAGE = "/receipt-payments/connect";
export const CALLBACK_PATH = "/api/receipt-payments/gmail/callback";
export const STATE_COOKIE = "receipt_payments_gmail_state";

export function receiptSetup() {
  return {
    database: Boolean(process.env.RECEIPT_PAYMENTS_DATABASE_URL?.trim()),
    oauth: Boolean(process.env.RECEIPT_GMAIL_CLIENT_ID?.trim() && process.env.RECEIPT_GMAIL_CLIENT_SECRET?.trim()),
    redirect: Boolean(process.env.RECEIPT_GMAIL_REDIRECT_URI?.trim()),
    encryption: (process.env.RECEIPT_TOKEN_ENCRYPTION_KEY?.trim().length ?? 0) >= 32,
  };
}

export function receiptRedirectUri() {
  const value = process.env.RECEIPT_GMAIL_REDIRECT_URI?.trim();
  if (!value) throw new Error("receipt_setup_required");
  const url = new URL(value);
  if (url.pathname !== CALLBACK_PATH || url.search || url.hash ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost"))) {
    throw new Error("receipt_setup_required");
  }
  return url.toString();
}

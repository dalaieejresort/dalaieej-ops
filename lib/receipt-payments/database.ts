import "server-only";
import { neon } from "@neondatabase/serverless";
import { RECEIPT_MAILBOX } from "./config";

// Dedicated credential database; deliberately no reconciliation fallback/import.
function sqlClient() {
  const url = process.env.RECEIPT_PAYMENTS_DATABASE_URL?.trim();
  if (!url) throw new Error("receipt_setup_required");
  return neon(url);
}

export async function getReceiptConnection() {
  const sql = sqlClient();
  try {
    const rows = await sql`SELECT email_address, encrypted_refresh_token
      FROM receipt_payments.gmail_connection WHERE email_address = ${RECEIPT_MAILBOX}`;
    const row = rows[0];
    return row ? { emailAddress: String(row.email_address), encryptedRefreshToken: String(row.encrypted_refresh_token) } : null;
  } catch (error) {
    // A fresh, dedicated database has no token until its first authorization.
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

export async function saveReceiptConnection(email: string, token: string) {
  if (email !== RECEIPT_MAILBOX) throw new Error("wrong_mailbox");
  const sql = sqlClient();
  // Preserve the old connection as an inactive record. Reads and new
  // authorizations are restricted to RECEIPT_MAILBOX; never relabel a token.
  // Migrate the original single-address constraint atomically on authorization.
  await sql.transaction([
    sql`CREATE SCHEMA IF NOT EXISTS receipt_payments`,
    sql`CREATE TABLE IF NOT EXISTS receipt_payments.gmail_connection (
    email_address TEXT PRIMARY KEY,
    encrypted_refresh_token TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
    sql`ALTER TABLE receipt_payments.gmail_connection
      DROP CONSTRAINT IF EXISTS gmail_connection_email_address_check`,
    sql`ALTER TABLE receipt_payments.gmail_connection
      ADD CONSTRAINT gmail_connection_email_address_check
      CHECK (email_address IN ('theenerzaya@gmail.com', 'dalaieejcamp@gmail.com'))`,
    sql`INSERT INTO receipt_payments.gmail_connection (email_address, encrypted_refresh_token)
    VALUES (${email}, ${token}) ON CONFLICT (email_address) DO UPDATE
    SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, connected_at = now()`,
  ]);
}

export async function deleteReceiptConnection() {
  const sql = sqlClient();
  await sql`DELETE FROM receipt_payments.gmail_connection WHERE email_address = ${RECEIPT_MAILBOX}`;
}

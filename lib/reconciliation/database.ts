import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type {
  ReconciliationDashboard,
  ReconciliationEvent,
  ReconciliationMailConnection,
  ReconciliationMailProvider,
  ReconciliationSetup,
  ReconciliationSupportingDocument,
} from "@/lib/reconciliation/types";

type SqlClient = NeonQueryFunction<false, false>;

let client: SqlClient | null = null;
let schemaPromise: Promise<void> | null = null;

export function getReconciliationSetup(): ReconciliationSetup {
  return {
    databaseConfigured: Boolean(process.env.RECONCILIATION_DATABASE_URL?.trim()),
    gmailOAuthConfigured: Boolean(
      process.env.RECONCILIATION_GMAIL_CLIENT_ID?.trim() &&
        process.env.RECONCILIATION_GMAIL_CLIENT_SECRET?.trim(),
    ),
    tokenEncryptionConfigured: Boolean(
      process.env.RECONCILIATION_TOKEN_ENCRYPTION_KEY?.trim() &&
        (process.env.RECONCILIATION_TOKEN_ENCRYPTION_KEY?.trim().length ?? 0) >= 32,
    ),
    receiptStorageConfigured: Boolean(
      process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
        (process.env.VERCEL_OIDC_TOKEN?.trim() &&
          process.env.BLOB_STORE_ID?.trim()),
    ),
  };
}

function getClient() {
  const connectionString = process.env.RECONCILIATION_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Standalone reconciliation database is not configured");
  }
  if (!client) client = neon(connectionString);
  return client;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getClient();
      const schemaPath = path.join(
        process.cwd(),
        "reconciliation",
        "schema.postgres.sql",
      );
      const schema = await readFile(schemaPath, "utf8");
      const statements = schema
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await sql.query(statement);
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getReconciliationDashboard(
  supportingDocumentDate?: string,
): Promise<ReconciliationDashboard> {
  const setup = getReconciliationSetup();
  const empty: ReconciliationDashboard = {
    setup,
    connections: [],
    connection: null,
    summary: {
      total: 0,
      awaitingReceipt: 0,
      candidates: 0,
      matched: 0,
      exceptions: 0,
    },
    events: [],
    supportingDocuments: [],
  };
  if (!setup.databaseConfigured) return empty;

  await ensureSchema();
  const sql = getClient();
  const [connectionRows, summaryRows, eventRows, supportingDocumentRows] = await Promise.all([
    sql`
      SELECT provider, email_address, connected_at, last_sync_at
      FROM (
        SELECT
          provider,
          email_address,
          connected_at,
          last_sync_at,
          CASE provider WHEN 'datacom' THEN 1 WHEN 'yahoo' THEN 2 ELSE 8 END AS priority
        FROM reconciliation.imap_connections
        WHERE connection_key IN ('datacom', 'yahoo', 'primary')
        UNION ALL
        SELECT
          'gmail'::text AS provider,
          email_address,
          connected_at,
          last_sync_at,
          3 AS priority
        FROM reconciliation.gmail_connections
        WHERE connection_key = 'primary'
      ) connection
      ORDER BY priority
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE reconciliation_status = 'awaiting_receipt')::int AS awaiting_receipt,
        COUNT(*) FILTER (WHERE reconciliation_status = 'candidate')::int AS candidates,
        COUNT(*) FILTER (WHERE reconciliation_status = 'matched')::int AS matched,
        COUNT(*) FILTER (WHERE reconciliation_status = 'exception')::int AS exceptions
      FROM reconciliation.bank_email_events
    `,
    sql`
      SELECT
        event.id,
        event.transaction_at,
        event.received_at,
        COALESCE(account.display_name, event.institution || ' account') AS account_label,
        COALESCE(account.ownership_scope, 'unknown') AS account_scope,
        COALESCE(event.counterparty_text, '') AS counterparty,
        COALESCE(event.destination_bank, '') AS destination_bank,
        COALESCE(event.description, '') AS description,
        event.amount_minor,
        COALESCE(event.currency, 'MNT') AS currency,
        event.minor_unit_digits,
        event.journal_no,
        event.authenticity_status,
        event.parse_status,
        event.reconciliation_status,
        receipt.id AS receipt_id,
        receipt.original_filename AS receipt_filename
      FROM reconciliation.bank_email_events event
      LEFT JOIN reconciliation.bank_accounts account
        ON account.id = event.bank_account_id
      LEFT JOIN LATERAL (
        SELECT uploaded_receipt.id, uploaded_receipt.original_filename
        FROM reconciliation.matches receipt_match
        JOIN reconciliation.receipts uploaded_receipt
          ON uploaded_receipt.id = receipt_match.receipt_id
        WHERE receipt_match.bank_email_event_id = event.id
          AND receipt_match.match_status = 'confirmed'
        ORDER BY receipt_match.created_at DESC
        LIMIT 1
      ) receipt ON TRUE
      ORDER BY COALESCE(event.transaction_at, event.received_at) DESC
      LIMIT 100
    `,
    supportingDocumentDate
      ? sql`
          SELECT
            id,
            document_key,
            reconciliation_date::text AS reconciliation_date,
            original_filename,
            content_type,
            file_size_bytes,
            created_at
          FROM reconciliation.daily_supporting_documents
          WHERE reconciliation_date = ${supportingDocumentDate}::date
          ORDER BY created_at DESC, id DESC
        `
      : Promise.resolve([]),
  ]);

  const connections: ReconciliationMailConnection[] = connectionRows.map(
    (connection) => ({
      provider: String(connection.provider) as ReconciliationMailProvider,
      emailAddress: String(connection.email_address),
      connectedAt: toIso(connection.connected_at) ?? new Date(0).toISOString(),
      lastSyncAt: toIso(connection.last_sync_at),
    }),
  );
  const summary = summaryRows[0];
  const events: ReconciliationEvent[] = eventRows.map((row) => ({
    id: String(row.id),
    transactionAt: toIso(row.transaction_at),
    receivedAt: toIso(row.received_at) ?? new Date(0).toISOString(),
    accountLabel: String(row.account_label),
    accountScope: row.account_scope as ReconciliationEvent["accountScope"],
    counterparty: String(row.counterparty),
    destinationBank: String(row.destination_bank),
    description: String(row.description),
    amountMinor: row.amount_minor === null ? null : asNumber(row.amount_minor),
    currency: String(row.currency),
    minorUnitDigits: asNumber(row.minor_unit_digits),
    journalNo: row.journal_no ? String(row.journal_no) : null,
    authenticityStatus:
      row.authenticity_status as ReconciliationEvent["authenticityStatus"],
    parseStatus: row.parse_status as ReconciliationEvent["parseStatus"],
    reconciliationStatus:
      row.reconciliation_status as ReconciliationEvent["reconciliationStatus"],
    receiptId: row.receipt_id ? String(row.receipt_id) : null,
    receiptFilename: row.receipt_filename
      ? String(row.receipt_filename)
      : null,
  }));
  const supportingDocuments: ReconciliationSupportingDocument[] =
    supportingDocumentRows.map((row) => ({
      id: String(row.id),
      documentKey: String(row.document_key),
      reconciliationDate: String(row.reconciliation_date),
      originalFilename: String(row.original_filename),
      contentType: String(row.content_type),
      fileSizeBytes: asNumber(row.file_size_bytes),
      createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    }));

  return {
    setup,
    connections,
    connection: connections[0] ?? null,
    summary: {
      total: asNumber(summary?.total),
      awaitingReceipt: asNumber(summary?.awaiting_receipt),
      candidates: asNumber(summary?.candidates),
      matched: asNumber(summary?.matched),
      exceptions: asNumber(summary?.exceptions),
    },
    events,
    supportingDocuments,
  };
}

export async function getStoredGmailConnection() {
  await ensureSchema();
  const rows = await getClient()`
    SELECT email_address, encrypted_refresh_token, scopes
    FROM reconciliation.gmail_connections
    WHERE connection_key = 'primary'
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        emailAddress: String(row.email_address),
        encryptedRefreshToken: String(row.encrypted_refresh_token),
        scopes: String(row.scopes),
      }
    : null;
}

export async function saveGmailConnection(input: {
  emailAddress: string;
  encryptedRefreshToken: string;
  scopes: string;
}) {
  await ensureSchema();
  await getClient()`
    INSERT INTO reconciliation.gmail_connections (
      connection_key,
      email_address,
      encrypted_refresh_token,
      scopes
    ) VALUES (
      'primary',
      ${input.emailAddress},
      ${input.encryptedRefreshToken},
      ${input.scopes}
    )
    ON CONFLICT (connection_key) DO UPDATE SET
      email_address = EXCLUDED.email_address,
      encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
      scopes = EXCLUDED.scopes,
      updated_at = NOW()
  `;
}

export async function deleteGmailConnection() {
  await ensureSchema();
  const rows = await getClient()`
    DELETE FROM reconciliation.gmail_connections
    WHERE connection_key = 'primary'
    RETURNING email_address
  `;
  return rows[0]?.email_address ? String(rows[0].email_address) : null;
}

export async function getStoredImapConnection(
  provider: "datacom" | "yahoo",
) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT provider, email_address, host, port, encrypted_password, last_sync_at
    FROM reconciliation.imap_connections
    WHERE connection_key = ${provider}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        provider: String(row.provider),
        emailAddress: String(row.email_address),
        host: String(row.host),
        port: asNumber(row.port),
        encryptedPassword: String(row.encrypted_password),
        lastSyncAt: toIso(row.last_sync_at),
      }
    : null;
}

export async function saveImapConnection(input: {
  provider: "datacom" | "yahoo";
  emailAddress: string;
  host: string;
  port: number;
  encryptedPassword: string;
}) {
  await ensureSchema();
  const sql = getClient();
  await sql`
    INSERT INTO reconciliation.imap_connections (
      connection_key,
      provider,
      email_address,
      host,
      port,
      encrypted_password
    ) VALUES (
      ${input.provider},
      ${input.provider},
      ${input.emailAddress},
      ${input.host},
      ${input.port},
      ${input.encryptedPassword}
    )
    ON CONFLICT (connection_key) DO UPDATE SET
      provider = EXCLUDED.provider,
      email_address = EXCLUDED.email_address,
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      encrypted_password = EXCLUDED.encrypted_password,
      connected_at = NOW(),
      last_sync_at = NULL,
      updated_at = NOW()
  `;
}

export async function deleteImapConnection(provider: "datacom" | "yahoo") {
  await ensureSchema();
  const rows = await getClient()`
    DELETE FROM reconciliation.imap_connections
    WHERE connection_key = ${provider}
    RETURNING email_address
  `;
  return rows[0]?.email_address ? String(rows[0].email_address) : null;
}

export async function hasBankEmailEvent(
  provider: ReconciliationMailProvider,
  providerMessageId: string,
) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT 1
    FROM reconciliation.bank_email_events
    WHERE provider = ${provider} AND provider_message_id = ${providerMessageId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function insertBankEmailEvent(input: {
  provider: ReconciliationMailProvider;
  providerMessageId: string;
  providerThreadId: string | null;
  internetMessageId: string | null;
  senderAddress: string;
  subject: string;
  receivedAt: string;
  institution: string;
  transactionAt: string | null;
  journalNo: string | null;
  direction: "inflow" | "outflow" | "unknown";
  fromAccountSuffix: string | null;
  toAccountSuffix: string | null;
  destinationBank: string | null;
  counterpartyText: string | null;
  description: string | null;
  amountMinor: number | null;
  currency: string | null;
  minorUnitDigits: number;
  authenticityStatus: "verified" | "unverified" | "failed";
  parseStatus: "parsed" | "partial" | "unsupported" | "failed";
  rawMetadata: Record<string, unknown>;
}) {
  await ensureSchema();
  const sql = getClient();
  let accountId: string | null = null;
  if (input.fromAccountSuffix) {
    const accountRows = await sql`
      INSERT INTO reconciliation.bank_accounts (
        institution,
        account_suffix,
        display_name
      ) VALUES (
        ${input.institution},
        ${input.fromAccountSuffix},
        ${`${input.institution} •••• ${input.fromAccountSuffix}`}
      )
      ON CONFLICT (institution, account_suffix) DO UPDATE SET
        updated_at = NOW()
      RETURNING id
    `;
    accountId = String(accountRows[0]?.id ?? "") || null;
  }

  const rows = await sql.query(
    `
      INSERT INTO reconciliation.bank_email_events (
        provider,
        provider_message_id,
        provider_thread_id,
        internet_message_id,
        sender_address,
        subject,
        received_at,
        institution,
        transaction_at,
        journal_no,
        direction,
        bank_account_id,
        to_account_suffix,
        destination_bank,
        counterparty_text,
        description,
        amount_minor,
        currency,
        minor_unit_digits,
        authenticity_status,
        parse_status,
        raw_metadata_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb
      )
      ON CONFLICT (provider, provider_message_id) DO NOTHING
      RETURNING id
    `,
    [
      input.provider,
      input.providerMessageId,
      input.providerThreadId,
      input.internetMessageId,
      input.senderAddress,
      input.subject,
      input.receivedAt,
      input.institution,
      input.transactionAt,
      input.journalNo,
      input.direction,
      accountId,
      input.toAccountSuffix,
      input.destinationBank,
      input.counterpartyText,
      input.description,
      input.amountMinor,
      input.currency,
      input.minorUnitDigits,
      input.authenticityStatus,
      input.parseStatus,
      JSON.stringify(input.rawMetadata),
    ],
  );
  return rows.length > 0;
}

export async function getReceiptUploadTarget(eventId: string) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT
      event.id,
      confirmed_match.receipt_id
    FROM reconciliation.bank_email_events event
    LEFT JOIN LATERAL (
      SELECT receipt_id
      FROM reconciliation.matches
      WHERE bank_email_event_id = event.id
        AND match_status = 'confirmed'
      LIMIT 1
    ) confirmed_match ON TRUE
    WHERE event.id = ${eventId}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        eventId: String(row.id),
        receiptId: row.receipt_id ? String(row.receipt_id) : null,
      }
    : null;
}

export async function saveUploadedReceipt(input: {
  eventId: string;
  receiptKey: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  storageReference: string;
}) {
  await ensureSchema();
  const rows = await getClient().query(
    `
      WITH target_event AS (
        SELECT event.id
        FROM reconciliation.bank_email_events event
        WHERE event.id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM reconciliation.matches existing_match
            WHERE existing_match.bank_email_event_id = event.id
              AND existing_match.match_status = 'confirmed'
          )
      ),
      inserted_receipt AS (
        INSERT INTO reconciliation.receipts (
          receipt_key,
          source,
          storage_reference,
          extraction_status,
          original_filename,
          content_type,
          file_size_bytes
        )
        SELECT $2, 'manual_upload', $3, 'pending', $4, $5, $6
        FROM target_event
        RETURNING id
      ),
      inserted_match AS (
        INSERT INTO reconciliation.matches (
          bank_email_event_id,
          receipt_id,
          confidence,
          match_status,
          match_reasons
        )
        SELECT
          target_event.id,
          inserted_receipt.id,
          1,
          'confirmed',
          '["manual_upload_for_transaction"]'::jsonb
        FROM target_event
        CROSS JOIN inserted_receipt
        RETURNING receipt_id
      ),
      updated_event AS (
        UPDATE reconciliation.bank_email_events
        SET reconciliation_status = 'matched', updated_at = NOW()
        WHERE id IN (SELECT id FROM target_event)
        RETURNING id
      )
      SELECT inserted_match.receipt_id
      FROM inserted_match
      CROSS JOIN updated_event
    `,
    [
      input.eventId,
      input.receiptKey,
      input.storageReference,
      input.originalFilename,
      input.contentType,
      input.fileSizeBytes,
    ],
  );
  const receiptId = rows[0]?.receipt_id;
  return receiptId ? String(receiptId) : null;
}

export async function getReceiptFile(receiptId: string) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT
      receipt.id,
      receipt.storage_reference,
      receipt.original_filename,
      receipt.content_type,
      receipt.file_size_bytes
    FROM reconciliation.receipts receipt
    JOIN reconciliation.matches receipt_match
      ON receipt_match.receipt_id = receipt.id
    WHERE receipt.id = ${receiptId}
      AND receipt_match.match_status = 'confirmed'
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        storageReference: String(row.storage_reference),
        originalFilename: String(row.original_filename || "receipt"),
        contentType: String(row.content_type || "application/octet-stream"),
        fileSizeBytes: asNumber(row.file_size_bytes),
      }
    : null;
}

export async function saveUploadedSupportingDocument(input: {
  documentKey: string;
  reconciliationDate: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  storageReference: string;
}) {
  await ensureSchema();
  const rows = await getClient()`
    INSERT INTO reconciliation.daily_supporting_documents (
      document_key,
      reconciliation_date,
      source,
      storage_reference,
      original_filename,
      content_type,
      file_size_bytes
    ) VALUES (
      ${input.documentKey},
      ${input.reconciliationDate}::date,
      'manual_upload',
      ${input.storageReference},
      ${input.originalFilename},
      ${input.contentType},
      ${input.fileSizeBytes}
    )
    ON CONFLICT (document_key) DO NOTHING
    RETURNING id
  `;
  const documentId = rows[0]?.id;
  return documentId ? String(documentId) : null;
}

export async function getSupportingDocumentByKey(documentKey: string) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT id
    FROM reconciliation.daily_supporting_documents
    WHERE document_key = ${documentKey}
    LIMIT 1
  `;
  return rows[0]?.id ? String(rows[0].id) : null;
}

export async function getSupportingDocumentFile(documentId: string) {
  await ensureSchema();
  const rows = await getClient()`
    SELECT
      id,
      storage_reference,
      original_filename,
      content_type,
      file_size_bytes
    FROM reconciliation.daily_supporting_documents
    WHERE id = ${documentId}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        id: String(row.id),
        storageReference: String(row.storage_reference),
        originalFilename: String(row.original_filename),
        contentType: String(row.content_type),
        fileSizeBytes: asNumber(row.file_size_bytes),
      }
    : null;
}

export async function startGmailSyncRun() {
  await ensureSchema();
  const rows = await getClient()`
    INSERT INTO reconciliation.gmail_sync_runs DEFAULT VALUES
    RETURNING id
  `;
  return String(rows[0].id);
}

export async function finishGmailSyncRun(input: {
  id: string;
  status: "completed" | "partially_completed" | "failed";
  found: number;
  imported: number;
  skipped: number;
  failed: number;
  errorMessage?: string | null;
}) {
  await ensureSchema();
  await getClient()`
    UPDATE reconciliation.gmail_sync_runs
    SET
      finished_at = NOW(),
      status = ${input.status},
      messages_found = ${input.found},
      messages_imported = ${input.imported},
      messages_skipped = ${input.skipped},
      messages_failed = ${input.failed},
      error_message = ${input.errorMessage ?? null}
    WHERE id = ${input.id}
  `;
  if (input.status !== "failed") {
    await getClient()`
      UPDATE reconciliation.gmail_connections
      SET last_sync_at = NOW(), updated_at = NOW()
      WHERE connection_key = 'primary'
    `;
  }
}

export async function startImapSyncRun(provider: "datacom" | "yahoo") {
  await ensureSchema();
  const rows = await getClient()`
    INSERT INTO reconciliation.imap_sync_runs (provider)
    VALUES (${provider})
    RETURNING id
  `;
  return String(rows[0].id);
}

export async function finishImapSyncRun(input: {
  id: string;
  provider: "datacom" | "yahoo";
  status: "completed" | "partially_completed" | "failed";
  found: number;
  imported: number;
  skipped: number;
  failed: number;
  errorMessage?: string | null;
}) {
  await ensureSchema();
  const sql = getClient();
  await sql`
    UPDATE reconciliation.imap_sync_runs
    SET
      finished_at = NOW(),
      status = ${input.status},
      messages_found = ${input.found},
      messages_imported = ${input.imported},
      messages_skipped = ${input.skipped},
      messages_failed = ${input.failed},
      error_message = ${input.errorMessage ?? null}
    WHERE id = ${input.id}
  `;
  if (input.status !== "failed") {
    await sql`
      UPDATE reconciliation.imap_connections
      SET last_sync_at = NOW(), updated_at = NOW()
      WHERE connection_key = ${input.provider}
    `;
  }
}

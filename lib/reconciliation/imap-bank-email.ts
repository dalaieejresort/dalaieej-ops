import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  deleteImapConnection,
  finishImapSyncRun,
  getStoredImapConnection,
  hasBankEmailEvent,
  insertBankEmailEvent,
  saveImapConnection,
  startImapSyncRun,
} from "@/lib/reconciliation/database";
import { parseKhanBankEmail } from "@/lib/reconciliation/khan-bank-email";
import { parseTdbEmail } from "@/lib/reconciliation/tdb-email";
import { decryptToken, encryptToken } from "@/lib/reconciliation/token-crypto";

export type ReconciliationImapProvider = "datacom" | "yahoo";

const KHAN_SENDER = "noreply@khanbank.com";
const TDB_SENDER = "ebank@tdbm.mn";
const MAX_FETCHED_MESSAGES = 100;
const TRANSACTIONS_MAILBOX = "Transactions";
const DEFAULT_YAHOO_KHAN_ACCOUNT_NUMBERS = [
  "5130019325",
  "5250687294",
] as const;

const PROVIDERS = {
  datacom: {
    label: "Datacom",
    host: "imap.mail.mn",
    port: 993,
    senders: [KHAN_SENDER, TDB_SENDER],
    passwordName: "mailbox password",
  },
  yahoo: {
    label: "Yahoo",
    host: "imap.mail.yahoo.com",
    port: 993,
    senders: [KHAN_SENDER],
    passwordName: "app password",
  },
} as const;

function clientFor(
  provider: ReconciliationImapProvider,
  input: { emailAddress: string; password: string },
) {
  const config = PROVIDERS[provider];
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: input.emailAddress, pass: input.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxLiteralSize: 8 * 1024 * 1024,
    maxResponseSize: 10 * 1024 * 1024,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
}

async function closeClient(client: ImapFlow) {
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

export async function connectImapMailbox(
  provider: ReconciliationImapProvider,
  input: { emailAddress: string; password: string },
) {
  const config = PROVIDERS[provider];
  const emailAddress = input.emailAddress.trim().toLowerCase();
  const password = input.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    throw new Error(`Enter a valid ${config.label} email address`);
  }
  if (!password || password.length > 512) {
    throw new Error(`Enter the ${config.label} ${config.passwordName}`);
  }

  const client = clientFor(provider, { emailAddress, password });
  try {
    await client.connect();
  } catch {
    client.close();
    throw new Error(
      `${config.label} could not verify that email address and ${config.passwordName}`,
    );
  }
  await closeClient(client);

  await saveImapConnection({
    provider,
    emailAddress,
    host: config.host,
    port: config.port,
    encryptedPassword: encryptToken(password),
  });
  return emailAddress;
}

export async function disconnectImapMailbox(
  provider: ReconciliationImapProvider,
) {
  return deleteImapConnection(provider);
}

function senderAddress(value: string) {
  return (value.match(/<([^>]+)>/)?.[1] ?? value).trim().toLowerCase();
}

function mongoliaTimestamp(value: string | null) {
  const match = value?.match(
    /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  return match
    ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
    : null;
}

function headerText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join("; ");
  return typeof value === "string" ? value : value ? String(value) : "";
}

function yahooKhanAccountAllowlist() {
  const configured = process.env.RECONCILIATION_YAHOO_KHAN_ACCOUNT_NUMBERS;
  const accountNumbers = configured
    ? configured.split(/[\s,;]+/)
    : [...DEFAULT_YAHOO_KHAN_ACCOUNT_NUMBERS];
  return accountNumbers
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
}

export async function syncBankEmailImap(
  provider: ReconciliationImapProvider,
  input?: { limit?: number; date?: string; incremental?: boolean },
) {
  const config = PROVIDERS[provider];
  const connection = await getStoredImapConnection(provider);
  if (!connection) {
    throw new Error(`${config.label} email is not connected`);
  }

  const password = decryptToken(connection.encryptedPassword);
  const client = clientFor(provider, {
    emailAddress: connection.emailAddress,
    password,
  });
  const runId = await startImapSyncRun(provider);
  let found = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let archived = 0;

  try {
    await client.connect();
    await client.mailboxCreate(TRANSACTIONS_MAILBOX);
    const lock = await client.getMailboxLock("INBOX", {
      readOnly: false,
      acquireTimeout: 10_000,
    });
    try {
      const since = input?.date
        ? input.date
        : input?.incremental
          ? new Date(connection.lastSyncAt || Date.now())
          : new Date();
      if (since instanceof Date && input?.incremental) {
        since.setUTCDate(since.getUTCDate() - 1);
      } else if (since instanceof Date) {
        since.setUTCFullYear(since.getUTCFullYear() - 2);
      }
      const nextDate = input?.date
        ? new Date(`${input.date}T00:00:00.000Z`)
        : null;
      nextDate?.setUTCDate(nextDate.getUTCDate() + 1);
      const senderCriteria =
        config.senders.length === 1
          ? { from: config.senders[0] }
          : { or: config.senders.map((from) => ({ from })) };
      const searchResult = await client.search(
        {
          ...senderCriteria,
          since,
          ...(nextDate
            ? { before: nextDate.toISOString().slice(0, 10) }
            : {}),
        },
        { uid: true },
      );
      const uids = (searchResult || [])
        .sort((left, right) => right - left)
        .slice(0, input?.limit ?? MAX_FETCHED_MESSAGES);
      found = uids.length;
      const uidValidity = client.mailbox
        ? client.mailbox.uidValidity.toString()
        : "unknown";
      const pendingUids: number[] = [];
      const archiveUids: number[] = [];

      for (const uid of uids) {
        const providerMessageId = `INBOX:${uidValidity}:${uid}`;
        if (await hasBankEmailEvent(provider, providerMessageId)) {
          skipped += 1;
          archiveUids.push(uid);
        } else {
          pendingUids.push(uid);
        }
      }

      for await (const message of pendingUids.length
        ? client.fetch(
            pendingUids,
            { uid: true, source: true, internalDate: true },
            { uid: true },
          )
        : []) {
        const providerMessageId = `INBOX:${uidValidity}:${message.uid}`;
        try {
          if (!message.source) throw new Error("Message content was unavailable");
          const mail = await simpleParser(message.source, {
            skipImageLinks: true,
            skipHtmlToText: true,
          });
          const sender = mail.from?.text ?? "";
          const subject = mail.subject ?? "";
          const authenticationResults = headerText(
            mail.headers.get("authentication-results"),
          );
          const html = typeof mail.html === "string" ? mail.html : "";
          const address = senderAddress(sender);
          const isTdb = address === TDB_SENDER;
          const parsed = isTdb
            ? parseTdbEmail({
                sender,
                subject,
                html,
                text: mail.text,
                authenticationResults,
              })
            : parseKhanBankEmail({
                sender,
                subject,
                html,
                authenticationResults,
                ...(provider === "yahoo"
                  ? {
                      allowedFromAccountNumbers:
                        yahooKhanAccountAllowlist(),
                    }
                  : {}),
              });
          if (
            "accountFilterStatus" in parsed &&
            parsed.accountFilterStatus === "blocked"
          ) {
            skipped += 1;
            continue;
          }
          if (parsed.parseStatus === "unsupported") {
            skipped += 1;
            archiveUids.push(message.uid);
            continue;
          }
          const receivedAt = new Date(
            message.internalDate || mail.date || Date.now(),
          ).toISOString();
          const inserted = await insertBankEmailEvent({
            provider,
            providerMessageId,
            providerThreadId: null,
            internetMessageId: mail.messageId || null,
            senderAddress: address,
            subject,
            receivedAt,
            institution: isTdb ? "Trade and Development Bank" : "Khan Bank",
            transactionAt: mongoliaTimestamp(parsed.transactionAt),
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
              provider,
              mailbox: "INBOX",
              parser: isTdb
                ? "tdb-transfer-notification-v1"
                : "khan-transfer-receipt-v1",
              authenticationChecked: Boolean(authenticationResults),
            },
          });
          if (inserted) imported += 1;
          else skipped += 1;
          archiveUids.push(message.uid);
        } catch {
          failed += 1;
        }
      }

      for (const uid of archiveUids) {
        try {
          const moved = await client.messageMove(uid, TRANSACTIONS_MAILBOX, {
            uid: true,
          });
          if (moved) archived += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      lock.release();
    }
    await closeClient(client);

    await finishImapSyncRun({
      id: runId,
      provider,
      status: failed === 0 ? "completed" : "partially_completed",
      found,
      imported,
      skipped,
      failed,
    });
    return { found, imported, skipped, failed, archived };
  } catch (error) {
    client.close();
    await finishImapSyncRun({
      id: runId,
      provider,
      status: "failed",
      found,
      imported,
      skipped,
      failed,
      errorMessage:
        error instanceof Error
          ? error.message
          : `${config.label} synchronization failed`,
    });
    throw new Error(`${config.label} email could not be checked securely`);
  }
}

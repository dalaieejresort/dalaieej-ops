import "server-only";

import {
  connectImapMailbox,
  disconnectImapMailbox,
  syncBankEmailImap,
} from "@/lib/reconciliation/imap-bank-email";

export function connectYahooMailbox(input: {
  emailAddress: string;
  password: string;
}) {
  return connectImapMailbox("yahoo", input);
}

export function disconnectYahooMailbox() {
  return disconnectImapMailbox("yahoo");
}

export function syncBankEmailYahoo(input?: {
  limit?: number;
  date?: string;
  incremental?: boolean;
}) {
  return syncBankEmailImap("yahoo", input);
}

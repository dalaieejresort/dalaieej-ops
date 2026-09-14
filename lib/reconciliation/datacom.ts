import "server-only";

import {
  connectImapMailbox,
  disconnectImapMailbox,
  syncBankEmailImap,
} from "@/lib/reconciliation/imap-bank-email";

export function connectDatacomMailbox(input: {
  emailAddress: string;
  password: string;
}) {
  return connectImapMailbox("datacom", input);
}

export function disconnectDatacomMailbox() {
  return disconnectImapMailbox("datacom");
}

export function syncBankEmailDatacom(input?: {
  limit?: number;
  date?: string;
  incremental?: boolean;
}) {
  return syncBankEmailImap("datacom", input);
}

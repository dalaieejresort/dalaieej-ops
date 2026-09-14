export type ReconciliationSetup = {
  databaseConfigured: boolean;
  gmailOAuthConfigured: boolean;
  tokenEncryptionConfigured: boolean;
  receiptStorageConfigured: boolean;
};

export type ReconciliationMailProvider = "gmail" | "datacom" | "yahoo";

export type ReconciliationMailConnection = {
  provider: ReconciliationMailProvider;
  emailAddress: string;
  connectedAt: string;
  lastSyncAt: string | null;
};

export type ReconciliationEvent = {
  id: string;
  transactionAt: string | null;
  receivedAt: string;
  accountLabel: string;
  accountScope: "business" | "personal" | "mixed" | "unknown";
  counterparty: string;
  destinationBank: string;
  description: string;
  amountMinor: number | null;
  currency: string;
  minorUnitDigits: number;
  journalNo: string | null;
  authenticityStatus: "verified" | "unverified" | "failed";
  parseStatus: "parsed" | "partial" | "unsupported" | "failed" | "pending";
  reconciliationStatus:
    | "awaiting_receipt"
    | "candidate"
    | "matched"
    | "no_receipt_required"
    | "exception";
  receiptId: string | null;
  receiptFilename: string | null;
};

export type ReconciliationSupportingDocument = {
  id: string;
  documentKey: string;
  reconciliationDate: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  createdAt: string;
};

export type ReconciliationDashboard = {
  setup: ReconciliationSetup;
  connections: ReconciliationMailConnection[];
  connection: ReconciliationMailConnection | null;
  summary: {
    total: number;
    awaitingReceipt: number;
    candidates: number;
    matched: number;
    exceptions: number;
  };
  events: ReconciliationEvent[];
  supportingDocuments: ReconciliationSupportingDocument[];
};

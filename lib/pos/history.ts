type HistoryEntryIdentity = {
  transactionId: string;
  receiptId?: string;
};

export function getHistoryEntryKey(entry: HistoryEntryIdentity): string {
  // One order can have several payment receipts. Legacy history has one
  // aggregate entry per transaction and no receipt ID.
  return entry.receiptId
    ? `receipt:${entry.receiptId}`
    : `transaction:${entry.transactionId}`;
}

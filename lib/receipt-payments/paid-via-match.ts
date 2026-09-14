export type ReceiptPaymentQuery = {
  amount: number;
  currency: string;
  supplier: string;
  reference: string;
  date: string;
};

export type BankPaymentCandidate = {
  id: string;
  institution: string;
  suffix: string;
  amount: number;
  currency: string;
  supplier: string;
  reference: string;
  date: string;
  journal: string;
  evidenceUrl: string;
};

// Only account-to-ledger mappings explicitly established by the owner.
const labels: Record<string, string> = {
  "Khan Bank:9325": "Чингис хаан - Хаан Банк",
};
const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function matchPaidVia(query: ReceiptPaymentQuery, candidates: BankPaymentCandidate[]) {
  const supplier = normalized(query.supplier);
  const reference = normalized(query.reference);
  const hits = candidates.filter((c) => {
    if (!labels[`${c.institution}:${c.suffix}`] || c.currency !== query.currency ||
        Math.abs(c.amount - query.amount) > 0.005) return false;
    const exactReference = reference.length >= 6 && normalized(c.reference) === reference;
    const sameSupplier = supplier.length >= 5 && supplier === normalized(c.supplier);
    const days = Math.abs(Date.parse(c.date) - Date.parse(query.date)) / 86400000;
    return exactReference || (sameSupplier && Number.isFinite(days) && days <= 30);
  });
// Duplicate emails for the same transfer must not create ambiguity.
  const unique = new Map(hits.map(c => [
    c.journal ? `${c.institution}:${c.suffix}:${c.journal}` : c.id, c,
  ]));
  if (unique.size !== 1) return { status: unique.size ? "ambiguous" : "no_match" };
  const c = [...unique.values()][0];
  return {
    status: "matched",
    label: labels[`${c.institution}:${c.suffix}`],
    evidence: `Bank email match: ${c.institution} ••••${c.suffix}; ${c.amount} ${c.currency}; ${c.date}; recipient ${c.supplier}; journal ${c.journal}; ${c.evidenceUrl}`,
  };
}

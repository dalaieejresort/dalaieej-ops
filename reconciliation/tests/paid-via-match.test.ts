import assert from "node:assert/strict";
import test from "node:test";
import { matchPaidVia, type BankPaymentCandidate } from "../../lib/receipt-payments/paid-via-match.ts";

const q = { amount: 77000, currency: "MNT", supplier: "ЖИШЭЭ НИЙЛҮҮЛЭГЧ", reference: "123456789012", date: "2026-09-03" };
const c: BankPaymentCandidate = { id: "mail1", institution: "Khan Bank", suffix: "9325", amount: 77000, currency: "MNT", supplier: "ЖИШЭЭ НИЙЛҮҮЛЭГЧ", reference: "123456789012", date: "2026-09-03T23:09:20+08:00", journal: "000000000001", evidenceUrl: "https://mail.google.com/mail/#all/mail1" };
test("explicit gross total and supplier/reference identify source account", () => {
  assert.equal(matchPaidVia(q, [c]).status, "matched");
  assert.equal(matchPaidVia({ ...q, amount: 70000 }, [c]).status, "no_match");
});
test("amount alone, unknown accounts and different currencies never auto match", () => {
  assert.equal(matchPaidVia({ ...q, supplier: "", reference: "" }, [c]).status, "no_match");
  assert.equal(matchPaidVia(q, [{ ...c, suffix: "0000" }]).status, "no_match");
  assert.equal(matchPaidVia(q, [{ ...c, currency: "USD" }]).status, "no_match");
});
test("distinct transfers are ambiguous; repeated emails for same journal deduplicate", () => {
  assert.equal(matchPaidVia(q, [c, { ...c, id: "mail2", journal: "other" }]).status, "ambiguous");
  assert.equal(matchPaidVia(q, [c, { ...c, id: "mail2" }]).status, "matched");
});
test("supplier-only match needs close date, and reference substring is insufficient", () => {
  assert.equal(matchPaidVia({ ...q, reference: "", date: "2025-01-01" }, [c]).status, "no_match");
  assert.equal(matchPaidVia({ ...q, supplier: "", reference: "123456789" }, [c]).status, "no_match");
});

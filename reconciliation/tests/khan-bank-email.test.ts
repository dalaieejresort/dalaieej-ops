import assert from "node:assert/strict";
import test from "node:test";
import { parseKhanBankEmail } from "../../lib/reconciliation/khan-bank-email.ts";

const sampleHtml = `
  <table>
    <tr><td>Огноо<span>/Date</span>:<b>2026.08.25 14:30:15</b></td></tr>
    <tr><td>Журналын<span>/Journal No:</span><b>001234567890</b></td></tr>
    <tr>
      <td>1234567890</td><td>ACCOUNT OWNER</td><td>85,000.00</td><td>MNT</td><td>1.00</td>
    </tr>
    <tr><td>05</td><td>Khan Bank - Хаан банк</td></tr>
    <tr><td>0987654321</td><td>EXAMPLE MERCHANT</td></tr>
    <tr><td>Гүйлгээний утга<span>/Transaction description:</span></td></tr>
    <tr><td>Office supplies</td></tr>
  </table>
`;

test("parses a verified Khan Bank transfer receipt without retaining full account numbers", () => {
  const parsed = parseKhanBankEmail({
    sender: "<noreply@khanbank.com>",
    subject: "Шилжүүлгийн баримт/Transaction receipt",
    authenticationResults: "dkim=pass; spf=pass; dmarc=pass",
    html: sampleHtml,
  });

  assert.equal(parsed.authenticityStatus, "verified");
  assert.equal(parsed.parseStatus, "parsed");
  assert.equal(parsed.transactionAt, "2026.08.25 14:30:15");
  assert.equal(parsed.journalNo, "001234567890");
  assert.equal(parsed.fromAccountSuffix, "7890");
  assert.equal(parsed.toAccountSuffix, "4321");
  assert.equal(parsed.amountMinor, 85000);
  assert.equal(parsed.currency, "MNT");
  assert.equal(parsed.toName, "EXAMPLE MERCHANT");
  assert.equal(parsed.description, "Office supplies");
});

test("rejects an unexpected sender", () => {
  const parsed = parseKhanBankEmail({
    sender: "noreply@example.com",
    subject: "Шилжүүлгийн баримт/Transaction receipt",
    authenticationResults: "dkim=pass; spf=pass; dmarc=pass",
    html: sampleHtml,
  });

  assert.equal(parsed.authenticityStatus, "failed");
});

test("accepts a transfer from an allowlisted source account without returning the full number", () => {
  const parsed = parseKhanBankEmail({
    sender: "<noreply@khanbank.com>",
    subject: "Шилжүүлгийн баримт/Transaction receipt",
    authenticationResults: "dkim=pass; spf=pass; dmarc=pass",
    html: sampleHtml,
    allowedFromAccountNumbers: ["1234567890"],
  });

  assert.equal(parsed.parseStatus, "parsed");
  assert.equal(parsed.accountFilterStatus, "allowed");
  assert.equal(parsed.fromAccountSuffix, "7890");
  assert.equal(Object.values(parsed).includes("1234567890"), false);
});

test("does not import a transfer from a source account outside the allowlist", () => {
  const parsed = parseKhanBankEmail({
    sender: "<noreply@khanbank.com>",
    subject: "Шилжүүлгийн баримт/Transaction receipt",
    authenticationResults: "dkim=pass; spf=pass; dmarc=pass",
    html: sampleHtml,
    allowedFromAccountNumbers: ["5250687294"],
  });

  assert.equal(parsed.parseStatus, "unsupported");
  assert.equal(parsed.accountFilterStatus, "blocked");
  assert.equal(parsed.fromAccountSuffix, null);
  assert.equal(parsed.amountMinor, null);
});

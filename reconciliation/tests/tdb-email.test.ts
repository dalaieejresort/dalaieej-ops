import assert from "node:assert/strict";
import test from "node:test";
import { parseTdbEmail } from "../../lib/reconciliation/tdb-email.ts";

const sampleHtml = `
  <html><body>
    <p>Огноо: <b>2026.08.24 10:04:21</b></p>
    <p>Журналын №: <b>123456789</b></p>
    <h3>Илгээгч</h3>
    <table>
      <tr><th>Дансны дугаар:</th><th>Нэр</th><th>Дүн</th><th>Ханш</th></tr>
      <tr><td>123456789</td><td>ЖИШЭЭ КОМПАНИ ХХК</td><td>15,800.00</td><td>MNT</td><td>1.00</td></tr>
    </table>
    <table>
      <tr><th>Банкны дугаар:</th><th>Банкны нэр</th></tr>
      <tr><td>34</td><td>Төрийн банк</td></tr>
      <tr><th>Дансны дугаар</th><th>Нэр</th></tr>
      <tr><td>MN000000000000004321</td><td>ЖИШЭЭ ХҮЛЭЭН АВАГЧ</td></tr>
    </table>
    <p>Гүйлгээний утга: <b>EB -такси</b></p>
    <p>Танд баярлалаа</p>
  </body></html>
`;

test("parses a TDB interbank transfer and retains only account suffixes", () => {
  const parsed = parseTdbEmail({
    sender: "Trade and Development Bank <ebank@tdbm.mn>",
    subject:
      "MN000000000000004321-Шилжүүлгийн мэдээлэл-Банк хооронд",
    html: sampleHtml,
  });

  assert.equal(parsed.authenticityStatus, "unverified");
  assert.equal(parsed.parseStatus, "parsed");
  assert.equal(parsed.transactionAt, "2026.08.24 10:04:21");
  assert.equal(parsed.journalNo, "123456789");
  assert.equal(parsed.fromAccountSuffix, "6789");
  assert.equal(parsed.toAccountSuffix, "4321");
  assert.equal(parsed.amountMinor, 15800);
  assert.equal(parsed.currency, "MNT");
  assert.equal(parsed.toName, "ЖИШЭЭ ХҮЛЭЭН АВАГЧ");
  assert.equal(parsed.destinationBank, "Төрийн банк");
  assert.equal(parsed.description, "EB -такси");
});

test("parses a TDB internal transfer", () => {
  const parsed = parseTdbEmail({
    sender: "ebank@tdbm.mn",
    subject: "987654321-Шилжүүлгийн мэдээлэл-Банк дотор",
    html: sampleHtml
      .replace("15,800.00", "100,000.00")
      .replace("MN000000000000004321", "987654321")
      .replace("ЖИШЭЭ ХҮЛЭЭН АВАГЧ", "ТЕСТ ХҮЛЭЭН АВАГЧ")
      .replace("Төрийн банк", "Худалдаа Хөгжлийн Банк")
      .replace("EB -такси", "EB -Example invoice 123456"),
  });

  assert.equal(parsed.parseStatus, "parsed");
  assert.equal(parsed.amountMinor, 100000);
  assert.equal(parsed.toAccountSuffix, "4321");
  assert.equal(parsed.toName, "ТЕСТ ХҮЛЭЭН АВАГЧ");
  assert.equal(parsed.destinationBank, "Худалдаа Хөгжлийн Банк");
});

test("rejects an unexpected TDB sender", () => {
  const parsed = parseTdbEmail({
    sender: "ebank@example.com",
    subject:
      "MN000000000000004321-Шилжүүлгийн мэдээлэл-Банк хооронд",
    html: sampleHtml,
    authenticationResults: "dkim=pass; spf=pass; dmarc=pass",
  });

  assert.equal(parsed.authenticityStatus, "failed");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  detectReceiptContentType,
  safeReceiptFilename,
} from "../../lib/reconciliation/receipt-file.ts";

test("detects supported receipt file signatures", () => {
  assert.equal(
    detectReceiptContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    "application/pdf",
  );
  assert.equal(
    detectReceiptContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
    "image/jpeg",
  );
  assert.equal(
    detectReceiptContentType(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
});

test("rejects an unsupported file signature", () => {
  assert.equal(detectReceiptContentType(new TextEncoder().encode("not a receipt")), null);
});

test("sanitizes receipt filenames without losing the extension", () => {
  assert.equal(
    safeReceiptFilename("../March receipt?.pdf", "application/pdf"),
    "March receipt_.pdf",
  );
  assert.equal(safeReceiptFilename("scan", "image/jpeg"), "scan.jpg");
});

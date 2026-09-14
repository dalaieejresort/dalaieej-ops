export type KhanBankEmailInput = {
  sender: string;
  subject: string;
  html: string;
  authenticationResults?: string;
  allowedFromAccountNumbers?: readonly string[];
};

export type ParsedKhanBankEmail = {
  authenticityStatus: "verified" | "unverified" | "failed";
  parseStatus: "parsed" | "partial" | "unsupported" | "failed";
  accountFilterStatus: "not_checked" | "allowed" | "blocked";
  transactionAt: string | null;
  journalNo: string | null;
  direction: "outflow";
  fromAccountSuffix: string | null;
  toAccountSuffix: string | null;
  toName: string | null;
  destinationBank: string | null;
  description: string | null;
  amountMinor: number | null;
  currency: string | null;
  minorUnitDigits: number;
};

const EXPECTED_SENDER = "noreply@khanbank.com";
const EXPECTED_SUBJECT = "Шилжүүлгийн баримт/Transaction receipt";

function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name] ?? match);
}

function cleanCell(value: string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function tableRows(html: string) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (row) =>
    Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (cell) =>
      cleanCell(cell[1]),
    ).filter(Boolean),
  ).filter((row) => row.length > 0);
}

function firstMatch(value: string, pattern: RegExp) {
  const match = value.match(pattern)?.[1]?.trim();
  return match || null;
}

function numericAmount(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function getAccountSuffix(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function senderAddress(sender: string) {
  return (sender.match(/<([^>]+)>/)?.[1] ?? sender).trim().toLowerCase();
}

function getAuthenticity(input: KhanBankEmailInput) {
  if (senderAddress(input.sender) !== EXPECTED_SENDER) return "failed" as const;
  const auth = input.authenticationResults?.toLowerCase() ?? "";
  if (!auth) return "unverified" as const;
  return auth.includes("dkim=pass") &&
    auth.includes("spf=pass") &&
    auth.includes("dmarc=pass")
    ? ("verified" as const)
    : ("failed" as const);
}

function emptyResult(
  authenticityStatus: ParsedKhanBankEmail["authenticityStatus"],
  parseStatus: ParsedKhanBankEmail["parseStatus"],
  accountFilterStatus: ParsedKhanBankEmail["accountFilterStatus"] = "not_checked",
): ParsedKhanBankEmail {
  return {
    authenticityStatus,
    parseStatus,
    accountFilterStatus,
    transactionAt: null,
    journalNo: null,
    direction: "outflow",
    fromAccountSuffix: null,
    toAccountSuffix: null,
    toName: null,
    destinationBank: null,
    description: null,
    amountMinor: null,
    currency: null,
    minorUnitDigits: 0,
  };
}

export function parseKhanBankEmail(input: KhanBankEmailInput) {
  const authenticityStatus = getAuthenticity(input);
  if (input.subject.trim() !== EXPECTED_SUBJECT) {
    return emptyResult(authenticityStatus, "unsupported");
  }

  try {
    const rows = tableRows(input.html);
    const visibleText = cleanCell(input.html);
    const transactionAt = firstMatch(
      visibleText,
      /Огноо\s*\/Date\s*:\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})/i,
    );
    const journalNo = firstMatch(
      visibleText,
      /Журналын\s*\/Journal No:\s*([0-9]+)/i,
    );
    const fromRow = rows.find(
      (row) =>
        row.length >= 5 &&
        /^\d{6,}$/.test(row[0]) &&
        numericAmount(row[2]) !== null &&
        /^[A-Z]{3}$/.test(row[3]),
    );
    const fromIndex = fromRow ? rows.indexOf(fromRow) : -1;
    const bankRow = rows.slice(fromIndex + 1).find(
      (row) =>
        row.length === 2 &&
        /^\d{1,3}$/.test(row[0]) &&
        /Bank|Банк|банк/.test(row[1]),
    );
    const bankIndex = bankRow ? rows.indexOf(bankRow) : -1;
    const toRow = rows
      .slice(bankIndex + 1)
      .find((row) => row.length === 2 && /^\d{6,}$/.test(row[0]));
    const descriptionLabelIndex = rows.findIndex((row) =>
      row.some((cell) => /Transaction description/i.test(cell)),
    );
    const description =
      descriptionLabelIndex >= 0
        ? rows.slice(descriptionLabelIndex + 1).find((row) => row.length === 1)?.[0] ?? null
        : null;
    const amount = fromRow ? numericAmount(fromRow[2]) : null;
    const currency = fromRow?.[3] ?? null;
    const digits = currency === "MNT" ? 0 : 2;
    const amountMinor = amount === null ? null : Math.round(amount * 10 ** digits);
    const fromAccountNumber = fromRow?.[0]?.replace(/\D/g, "") ?? null;
    if (
      input.allowedFromAccountNumbers &&
      (!fromAccountNumber ||
        !input.allowedFromAccountNumbers.includes(fromAccountNumber))
    ) {
      return emptyResult(authenticityStatus, "unsupported", "blocked");
    }
    const required = [transactionAt, fromRow?.[0], amountMinor, currency, toRow?.[0]];

    return {
      authenticityStatus,
      parseStatus: required.every((value) => value !== null && value !== undefined)
        ? ("parsed" as const)
        : ("partial" as const),
      accountFilterStatus: input.allowedFromAccountNumbers
        ? ("allowed" as const)
        : ("not_checked" as const),
      transactionAt,
      journalNo,
      direction: "outflow" as const,
      fromAccountSuffix: getAccountSuffix(fromRow?.[0]),
      toAccountSuffix: getAccountSuffix(toRow?.[0]),
      toName: toRow?.[1] ?? null,
      destinationBank: bankRow?.[1] ?? null,
      description,
      amountMinor,
      currency,
      minorUnitDigits: digits,
    };
  } catch {
    return emptyResult(authenticityStatus, "failed");
  }
}

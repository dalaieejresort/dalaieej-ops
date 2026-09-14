export type TdbEmailInput = {
  sender: string;
  subject: string;
  html: string;
  text?: string;
  authenticationResults?: string;
};

export type ParsedTdbEmail = {
  authenticityStatus: "verified" | "unverified" | "failed";
  parseStatus: "parsed" | "partial" | "unsupported" | "failed";
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

const EXPECTED_SENDER = "ebank@tdbm.mn";
const EXPECTED_SUBJECT = /Шилжүүлгийн мэдээлэл-Банк (?:дотор|хооронд)/i;

function senderAddress(sender: string) {
  return (sender.match(/<([^>]+)>/)?.[1] ?? sender).trim().toLowerCase();
}

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
    .replace(/&([a-z]+);/gi, (match, name: string) =>
      entities[name.toLowerCase()] ?? match,
    );
}

function visibleText(input: TdbEmailInput) {
  const source = input.text?.trim() || input.html;
  return decodeEntities(
    source
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() || null;
}

function accountSuffix(value: string | null) {
  const compact = value?.replace(/[^a-z0-9]/gi, "") ?? "";
  return compact.length >= 4 ? compact.slice(-4) : null;
}

function amountMinor(value: string | null, digits: number) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 10 ** digits) : null;
}

function authenticity(input: TdbEmailInput) {
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
  authenticityStatus: ParsedTdbEmail["authenticityStatus"],
  parseStatus: ParsedTdbEmail["parseStatus"],
): ParsedTdbEmail {
  return {
    authenticityStatus,
    parseStatus,
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

export function parseTdbEmail(input: TdbEmailInput): ParsedTdbEmail {
  const authenticityStatus = authenticity(input);
  if (!EXPECTED_SUBJECT.test(input.subject.trim())) {
    return emptyResult(authenticityStatus, "unsupported");
  }

  try {
    const text = visibleText(input);
    const transactionAt = firstMatch(
      text,
      /Огноо\s*:\s*(\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2})/i,
    );
    const journalNo = firstMatch(text, /Журналын\s*№\s*:\s*([0-9]+)/i);
    const senderBlock = text.match(
      /Илгээгч[\s\S]*?Дансны дугаар\s*:\s*Нэр\s+Дүн\s+Ханш\s+([A-Z]{2}[A-Z0-9]{10,}|\d{6,})\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+([A-Z]{3})\s+[\d,.]+/i,
    );
    const destinationBank = firstMatch(
      text,
      /Банкны дугаар\s*:\s*Банкны нэр\s+(?:\d{1,3}\s+)?(.+?)\s+Дансны дугаар\s+Нэр/i,
    );
    const recipientBlock = text.match(
      /Дансны дугаар\s+Нэр\s+([A-Z]{2}[A-Z0-9]{10,}|\d{6,})\s+(.+?)\s+Гүйлгээний утга\s*:/i,
    );
    const description = firstMatch(
      text,
      /Гүйлгээний утга\s*:\s*(.+?)(?:\s+Танд баярлалаа|\s+Хүндэтгэсэн|$)/i,
    );
    const currency = senderBlock?.[4]?.toUpperCase() ?? null;
    const minorUnitDigits = currency === "MNT" ? 0 : 2;
    const parsedAmount = amountMinor(senderBlock?.[3] ?? null, minorUnitDigits);
    const fromAccountSuffix = accountSuffix(senderBlock?.[1] ?? null);
    const toAccountSuffix = accountSuffix(recipientBlock?.[1] ?? null);
    const required = [
      transactionAt,
      journalNo,
      fromAccountSuffix,
      toAccountSuffix,
      parsedAmount,
      currency,
    ];

    return {
      authenticityStatus,
      parseStatus: required.every((value) => value !== null)
        ? "parsed"
        : "partial",
      transactionAt,
      journalNo,
      direction: "outflow",
      fromAccountSuffix,
      toAccountSuffix,
      toName: recipientBlock?.[2]?.trim() || null,
      destinationBank,
      description,
      amountMinor: parsedAmount,
      currency,
      minorUnitDigits,
    };
  } catch {
    return emptyResult(authenticityStatus, "failed");
  }
}

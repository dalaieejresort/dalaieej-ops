const PDF = "application/pdf";
const JPEG = "image/jpeg";
const PNG = "image/png";
const WEBP = "image/webp";
const HEIC = "image/heic";
const HEIF = "image/heif";

export const RECEIPT_FILE_LIMIT_BYTES = 10 * 1024 * 1024;
export const RECEIPT_CONTENT_TYPES = [PDF, JPEG, PNG, WEBP, HEIC, HEIF] as const;
export const RECEIPT_ACCEPT = RECEIPT_CONTENT_TYPES.join(",");

export function isReceiptContentType(value: string) {
  return RECEIPT_CONTENT_TYPES.some((contentType) => contentType === value);
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectReceiptContentType(bytes: Uint8Array) {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return PNG;
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return WEBP;
  }
  const box = new TextDecoder("ascii").decode(bytes.slice(4, 12));
  if (["ftypheic", "ftypheix", "ftyphevc", "ftyphevx"].includes(box)) {
    return HEIC;
  }
  if (["ftypmif1", "ftypmsf1", "ftypheif"].includes(box)) return HEIF;
  return null;
}

export function safeReceiptFilename(value: string, contentType: string) {
  const fallbackExtension: Record<string, string> = {
    [PDF]: ".pdf",
    [JPEG]: ".jpg",
    [PNG]: ".png",
    [WEBP]: ".webp",
    [HEIC]: ".heic",
    [HEIF]: ".heif",
  };
  const basename = value
    .normalize("NFKC")
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .trim()
    .slice(0, 160);
  const fallback = `receipt${fallbackExtension[contentType] ?? ""}`;
  const filename = basename || fallback;
  return filename.includes(".")
    ? filename
    : `${filename}${fallbackExtension[contentType] ?? ""}`;
}

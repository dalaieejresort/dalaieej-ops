import { randomUUID } from "node:crypto";
import { del, get } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { saveUploadedSupportingDocument } from "@/lib/reconciliation/database";
import {
  detectReceiptContentType,
  isReceiptContentType,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_FILE_LIMIT_BYTES,
  safeReceiptFilename,
} from "@/lib/reconciliation/receipt-file";
import { requireApiSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

type SupportingDocumentUploadPayload = {
  documentKey: string;
  reconciliationDate: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
};

function parsePayload(value: string | null): SupportingDocumentUploadPayload {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : null;
  } catch {
    throw new Error("Supporting document upload details are invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Supporting document upload details are missing");
  }
  const input = parsed as Partial<SupportingDocumentUploadPayload>;
  if (
    typeof input.documentKey !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.documentKey,
    ) ||
    typeof input.reconciliationDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.reconciliationDate) ||
    typeof input.originalFilename !== "string" ||
    !input.originalFilename.trim() ||
    typeof input.contentType !== "string" ||
    !isReceiptContentType(input.contentType) ||
    typeof input.fileSizeBytes !== "number" ||
    !Number.isInteger(input.fileSizeBytes) ||
    input.fileSizeBytes < 1 ||
    input.fileSizeBytes > RECEIPT_FILE_LIMIT_BYTES
  ) {
    throw new Error("Supporting document upload details are invalid");
  }
  return {
    documentKey: input.documentKey,
    reconciliationDate: input.reconciliationDate,
    originalFilename: safeReceiptFilename(
      input.originalFilename,
      input.contentType,
    ),
    contentType: input.contentType,
    fileSizeBytes: input.fileSizeBytes,
  };
}

function pathnameFor(payload: SupportingDocumentUploadPayload) {
  return `reconciliation-supporting-documents/${payload.reconciliationDate}/${payload.documentKey}/${payload.originalFilename}`;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function verifyUploadedBlob(
  blobUrl: string,
  expectedContentType: string,
  expectedSize: number,
) {
  const result = await get(blobUrl, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    throw new Error("Uploaded supporting document could not be read back");
  }
  if (result.blob.size !== expectedSize) {
    await result.stream.cancel();
    throw new Error("Uploaded supporting document size did not match");
  }
  const reader = result.stream.getReader();
  const firstChunk = await reader.read();
  await reader.cancel();
  const detected = firstChunk.value
    ? detectReceiptContentType(firstChunk.value)
    : null;
  if (detected !== expectedContentType) {
    throw new Error("Uploaded supporting document did not match its file type");
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-vercel-id") || randomUUID();
  try {
    const body = (await request.json()) as HandleUploadBody;
    if (body.type === "blob.generate-client-token") {
      const sessionOrResponse = requireApiSession(request, "owner");
      if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
      if (!sameOrigin(request)) {
        return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
      }
    }

    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        if (pathname !== pathnameFor(payload)) {
          throw new Error("Supporting document upload path is invalid");
        }
        return {
          allowedContentTypes: [...RECEIPT_CONTENT_TYPES],
          maximumSizeInBytes: RECEIPT_FILE_LIMIT_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify(payload),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parsePayload(tokenPayload ?? null);
        try {
          if (
            blob.pathname !== pathnameFor(payload) ||
            blob.contentType !== payload.contentType
          ) {
            throw new Error("Completed supporting document upload did not match its token");
          }
          await verifyUploadedBlob(
            blob.url,
            payload.contentType,
            payload.fileSizeBytes,
          );
          const documentId = await saveUploadedSupportingDocument({
            documentKey: payload.documentKey,
            reconciliationDate: payload.reconciliationDate,
            originalFilename: payload.originalFilename,
            contentType: payload.contentType,
            fileSizeBytes: payload.fileSizeBytes,
            storageReference: blob.url,
          });
          if (!documentId) {
            throw new Error("Supporting document already exists");
          }
        } catch (error) {
          await del(blob.url).catch(() => undefined);
          throw error;
        }
      },
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store", "x-request-id": requestId },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "supporting_document_upload_failed",
        route: "/api/reconciliation/supporting-documents/upload",
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Supporting document upload failed",
        requestId,
      },
      { status: 400 },
    );
  }
}

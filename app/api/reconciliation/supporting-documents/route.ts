import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  getSupportingDocumentByKey,
  getSupportingDocumentFile,
} from "@/lib/reconciliation/database";
import { withProtectedApiRoute } from "@/lib/server/api-route";

export const dynamic = "force-dynamic";

function safeHeaderFilename(value: string) {
  return value
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 160) || "supporting-document";
}

async function handleGET(request: Request) {
  const url = new URL(request.url);
  const documentKey = url.searchParams.get("key");
  if (documentKey) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        documentKey,
      )
    ) {
      return NextResponse.json({ error: "Invalid supporting document" }, { status: 400 });
    }
    return NextResponse.json(
      { documentId: await getSupportingDocumentByKey(documentKey) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const documentId = url.searchParams.get("id");
  if (!documentId || !/^\d+$/.test(documentId)) {
    return NextResponse.json({ error: "Invalid supporting document" }, { status: 400 });
  }
  const document = await getSupportingDocumentFile(documentId);
  if (!document) {
    return NextResponse.json({ error: "Supporting document not found" }, { status: 404 });
  }
  const blob = await get(document.storageReference, {
    access: "private",
    useCache: false,
  });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Supporting document file not found" }, { status: 404 });
  }
  return new Response(blob.stream, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${safeHeaderFilename(document.originalFilename)}"`,
      "Content-Length": String(document.fileSizeBytes),
      "Content-Type": document.contentType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withProtectedApiRoute(
  "/api/reconciliation/supporting-documents",
  "owner",
  handleGET,
);

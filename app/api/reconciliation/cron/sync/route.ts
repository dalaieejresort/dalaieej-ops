import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getStoredImapConnection } from "@/lib/reconciliation/database";
import {
  syncBankEmailImap,
  type ReconciliationImapProvider,
} from "@/lib/reconciliation/imap-bank-email";

export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.RECONCILIATION_SYNC_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const providers: ReconciliationImapProvider[] = ["datacom", "yahoo"];
    const results: Array<{
      provider: ReconciliationImapProvider;
      found: number;
      imported: number;
      skipped: number;
      failed: number;
      archived: number;
    }> = [];

    for (const provider of providers) {
      if (!(await getStoredImapConnection(provider))) continue;
      results.push({
        provider,
        ...(await syncBankEmailImap(provider, {
          incremental: true,
          limit: 100,
        })),
      });
    }

    const result = results.reduce(
      (total, current) => ({
        found: total.found + current.found,
        imported: total.imported + current.imported,
        skipped: total.skipped + current.skipped,
        failed: total.failed + current.failed,
        archived: total.archived + current.archived,
      }),
      { found: 0, imported: 0, skipped: 0, failed: 0, archived: 0 },
    );
    console.info(
      JSON.stringify({
        level: "info",
        message: "scheduled_reconciliation_sync_completed",
        ...result,
        providers: results,
        durationMs: Date.now() - startedAt,
      }),
    );
    return NextResponse.json({ ...result, providers: results }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "scheduled_reconciliation_sync_failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }),
    );
    return NextResponse.json(
      { error: "Scheduled reconciliation sync failed" },
      { status: 500 },
    );
  }
}

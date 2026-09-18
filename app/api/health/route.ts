import { posBackend, posQuery, posSchema } from "@/lib/server/pos-storage/transaction";
import { performance } from "node:perf_hooks";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { NextResponse } from "next/server";
import { getCachedRead } from "@/lib/server/read-cache";

const HEALTH_CACHE_TTL_MS = 60_000;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

function sheetsErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|quota|rate limit/i.test(message)) return "SHEETS_RATE_LIMITED";
  if (/credential|private key|invalid_grant|DECODER|unauthorized/i.test(message)) {
    return "SHEETS_AUTH_FAILED";
  }
  if (/GOOGLE_/i.test(message)) return "SHEETS_CONFIG_MISSING";
  return "SHEETS_UNAVAILABLE";
}

export async function GET() {
  if (posBackend() === "postgres") {
    try {
      const result = await posQuery(`SELECT count(*)::int AS datasets FROM ${posSchema()}.datasets`);
      if (Number(result.rows[0].datasets) < 8) throw new Error("POS import incomplete");
      return NextResponse.json({status:"healthy",storage:"postgres",database:"connected",writesPaused:process.env.POS_WRITES_PAUSED === "true",checkedAt:new Date().toISOString()}, {headers:{"Cache-Control":"no-store"}});
    } catch {
      return NextResponse.json({status:"degraded",storage:"postgres",code:"POS_DATABASE_UNAVAILABLE"}, {status:503,headers:{"Cache-Control":"no-store"}});
    }
  }
  const result = await getCachedRead(
    "health:google-sheets",
    HEALTH_CACHE_TTL_MS,
    async () => {
      const startedAt = performance.now();
      try {
        const auth = new JWT({
          email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
          key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
        const document = new GoogleSpreadsheet(requiredEnv("GOOGLE_SHEET_ID"), auth);
        await document.loadInfo();
        return {
          httpStatus: 200,
          body: {
            status: "healthy",
            sheets: "connected",
            checkedAt: new Date().toISOString(),
            latencyMs: Math.round(performance.now() - startedAt),
          },
        };
      } catch (error) {
        const code = sheetsErrorCode(error);
        console.error(JSON.stringify({
          level: "error",
          message: "health_check_failed",
          component: "google_sheets",
          code,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        }));
        return {
          httpStatus: 503,
          body: {
            status: "degraded",
            sheets: "unavailable",
            code,
            checkedAt: new Date().toISOString(),
          },
        };
      }
    },
  );

  return NextResponse.json({...result.body,storage:"sheets",writesPaused:process.env.POS_WRITES_PAUSED === "true"}, {
    status: result.httpStatus,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

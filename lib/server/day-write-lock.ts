import "server-only";
import { inPosTransaction, posBackend } from "./pos-storage/transaction";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

// One shared lock for all day transitions, including requests from different phones.
// Fail closed if coordination is unavailable; never fall back to a process-local lock.
export async function acquireDayWriteLock() {
  if (posBackend() === "postgres") {
    if (!inPosTransaction()) throw new Error("POS day writes require a transaction");
    return { async assertOwned() { if (!inPosTransaction()) throw new Error("POS transaction ended"); }, async release() {} };
  }
  const redis = Redis.fromEnv();
  const key = `dalaieej:day-write:${process.env.GOOGLE_SHEET_ID}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, { nx: true, ex: 300 });
  if (!acquired) return null;
  return {
    async assertOwned() {
      if (await redis.get(key) !== token) throw new Error("Day write lock expired");
    },
    async release() {
      await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        [key], [token],
      );
    },
  };
}

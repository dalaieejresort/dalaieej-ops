import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, neonConfig } from '@neondatabase/serverless';
import type { Query } from './types';

type Context = {query: Query; active: boolean; effects: Array<() => Promise<unknown>>};
const context = new AsyncLocalStorage<Context>();
let pool: Pool | undefined;
export function posBackend() {
  const value = process.env.POS_STORAGE_BACKEND?.trim() || 'sheets';
  if(value !== 'sheets' && value !== 'postgres') throw new Error('Invalid POS_STORAGE_BACKEND');
  return value;
}
export function posSchema() {
  const value=process.env.POS_DATABASE_SCHEMA?.trim() || 'pos';
  if(!/^pos(?:_[a-z0-9_]+)?$/.test(value)) throw new Error('Invalid POS_DATABASE_SCHEMA');
  return '"'+value+'"';
}
function getPool() {
  if(pool) return pool;
  const connectionString=process.env.POS_DATABASE_URL?.trim();
  if(!connectionString) throw new Error('POS_DATABASE_URL is missing');
  neonConfig.webSocketConstructor=globalThis.WebSocket;
  return pool=new Pool({connectionString,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
}
export async function posQuery(sql: string, params: unknown[] = []) {
  const current=context.getStore();
  if(current?.active) return current.query(sql,params);
  return getPool().query(sql,params);
}
export function inPosTransaction() { return context.getStore()?.active === true; }
export function deferPosEffect(effect: () => Promise<unknown>) {
  const current=context.getStore();
  if(!current?.active) return false;
  current.effects.push(effect);
  return true;
}
export async function withPosTransaction<T>(work: () => Promise<T>, accept: (value:T) => boolean = () => true): Promise<T> {
  if(posBackend() !== 'postgres' || inPosTransaction()) return work();
  const client=await getPool().connect();
  const current:Context={query:(sql,params)=>client.query(sql,params),active:true,effects:[]};
  let result:T;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    // Acquire before reading: all instances serialize inventory, receipts, refunds,
    // and day transitions together. READ COMMITTED then sees the preceding commit.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['dalaieej:'+posSchema()]);
    result=await context.run(current,work);
    if(accept(result)) await client.query('COMMIT');
    else { await client.query('ROLLBACK'); current.effects=[]; }
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { current.active=false; client.release(); }
  for(const effect of current.effects) {
    try { await effect(); } catch(error) { console.error('POS post-commit projection failed',error instanceof Error?error.message:'unknown'); }
  }
  return result;
}

import 'server-only';
import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { get, put } from '@vercel/blob';
import { posSchema } from './transaction';

function canonical(value: unknown): string {
  // The HTTP driver may share timestamp parsers with Pool in a warm function.
  // Hash dates exactly as they are serialized in the downloaded JSON archive.
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function archivePosDatabase() {
  const token = process.env.POS_BACKUP_BLOB_TOKEN;
  const connection = process.env.POS_DATABASE_URL;
  if (!token || !connection) throw new Error('POS backup is not configured');
  const schema = posSchema();
  const sql = neon(connection);
  const names = ['datasets', 'records', 'imports', 'audit'];
  const results = await sql.transaction(names.map(table => sql.query(
    `SELECT * FROM ${schema}.${table} ORDER BY ${table === 'records' ? 'dataset_id,row_number' : table === 'imports' ? 'source_sha256' : 'id'}`,
  )), { isolationLevel: 'RepeatableRead', readOnly: true });
  const data = {
    format: 'dalaieej-pos-backup-v1', createdAt: new Date().toISOString(),
    schema: JSON.parse(schema) as string,
    tables: Object.fromEntries(names.map((name, i) => [name, results[i]])),
  };
  const sha256 = createHash('sha256').update(canonical(data)).digest('hex');
  const body = JSON.stringify({ ...data, sha256 });
  const blob = await put(`pos/backups/${data.createdAt.replaceAll(':', '-')}.json`, body, {
    token, access: 'private', contentType: 'application/json', addRandomSuffix: true,
  });
  const downloaded = await get(blob.url, { token, access: 'private', useCache: false });
  if (!downloaded?.stream || await new Response(downloaded.stream).text() !== body) {
    throw new Error('POS backup download verification failed');
  }
  return { pathname: blob.pathname, sha256, createdAt: data.createdAt, records: results[1].length };
}

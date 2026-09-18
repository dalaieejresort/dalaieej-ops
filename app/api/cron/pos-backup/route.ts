import { timingSafeEqual } from 'node:crypto';
import { archivePosDatabase } from '@/lib/server/pos-storage/backup';
import { posBackend } from '@/lib/server/pos-storage/transaction';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (posBackend() !== 'postgres') return Response.json({ skipped: true, reason: 'POS is still on Sheets' });
  try {
    const archive = await archivePosDatabase();
    console.info(JSON.stringify({ event: 'pos_backup_verified', ...archive }));
    return Response.json({ ok: true, ...archive }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('POS backup failed', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'POS backup failed' }, { status: 500 });
  }
}

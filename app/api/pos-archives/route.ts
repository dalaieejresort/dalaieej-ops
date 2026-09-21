import { createHash } from 'node:crypto';
import { get } from '@vercel/blob';
import { withProtectedApiRoute } from '@/lib/server/api-route';
import { listPosArchives } from '@/lib/server/pos-archives';
export const dynamic='force-dynamic';
export const GET=withProtectedApiRoute('/api/pos-archives','owner',async request=>{
 const archives=await listPosArchives();const id=new URL(request.url).searchParams.get('id');
 if(!id)return Response.json({archives:archives.map(({blobUrl,...a})=>{void blobUrl;return a;})},{headers:{'Cache-Control':'private, no-store'}});
 const entry=archives.find(a=>a.id===id);if(!entry)return Response.json({error:'Archive not found'},{status:404});
 const url=new URL(entry.blobUrl);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.blob.vercel-storage.com')||!url.pathname.startsWith('/pos/season-archives/'))throw Error('Invalid stored archive path');
 const file=await get(entry.blobUrl,{token:process.env.POS_BACKUP_BLOB_TOKEN,access:'private',useCache:false});if(!file?.stream)throw Error('Archive unavailable');
 const bytes=Buffer.from(await new Response(file.stream).arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Archive checksum mismatch');
 return new Response(bytes,{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="pos-${entry.kind==='full'?'full-backup':entry.season||'undated'}-${entry.createdAt.slice(0,10)}.json"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
});

import { requireApiSession } from '@/lib/server/auth';
import { readHotelSource } from '@/lib/server/hotel';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const session=requireApiSession(request,'reception');if(session instanceof Response)return session;
 const id=new URL(request.url).searchParams.get('id')||'';
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return Response.json({error:'Захиалгын дугаар буруу байна.'},{status:400});
 try{return Response.json(await readHotelSource(`/hotel/reservation?id=${encodeURIComponent(id)}`),{headers:{'Cache-Control':'private, no-store'}});}
 catch{return Response.json({error:'Холбоо барих мэдээлэл ачаалагдсангүй.'},{status:503});}
}

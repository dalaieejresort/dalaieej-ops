import { requireApiSession } from '@/lib/server/auth';
import { withProtectedApiRoute } from '@/lib/server/api-route';
import { hotelBoard, saveHotel, HotelInputError } from '@/lib/server/hotel';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Read the external source outside the POS transaction lock.
export async function GET(request:Request) {
 const session=requireApiSession(request,'housekeeping');if(session instanceof Response)return session;
 try{return Response.json(await hotelBoard(session),{headers:{'Cache-Control':'private, no-store'}});}
 catch {return Response.json({error:'Буудлын мэдээллийг ачаалж чадсангүй.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const POST=withProtectedApiRoute('/api/hotel','housekeeping',async request=>{
 const session=requireApiSession(request,'housekeeping');if(session instanceof Response)return session;
 try {const input=await request.json();if(!input||typeof input!=='object'||Array.isArray(input))throw new HotelInputError('Хүсэлт буруу байна.');return Response.json(await saveHotel(input,session),{headers:{'Cache-Control':'no-store'}});}
 catch(error){if(error instanceof HotelInputError || error instanceof SyntaxError)return Response.json({error:error.message},{status:error instanceof HotelInputError?error.status:400});throw error;}
});

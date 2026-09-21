import { requirePageSession } from '@/lib/server/auth';
import { HotelWorkspace } from '@/components/hotel/HotelWorkspace';
export const dynamic='force-dynamic';
export const metadata={title:'Буудал'};
export default async function HotelPage(){const session=await requirePageSession('/hotel','housekeeping');return <HotelWorkspace role={session.role}/>;}

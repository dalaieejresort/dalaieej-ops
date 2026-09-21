import { requirePageSession } from '@/lib/server/auth';
import { Products } from '@/components/products/Products';
export const dynamic='force-dynamic';
export const metadata={title:'Products & stock'};
export default async function Page(){const session=await requirePageSession('/products','manager');return <Products role={session.role}/>;}

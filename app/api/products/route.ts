import { withProtectedApiRoute } from '@/lib/server/api-route';
import { requireApiSession } from '@/lib/server/auth';
import { listProducts, ProductInputError, saveProductOperation } from '@/lib/server/products';
export const dynamic = 'force-dynamic';
export const GET = withProtectedApiRoute('/api/products','manager',async () => Response.json({products:await listProducts()},{headers:{'Cache-Control':'no-store'}}));
export const POST = withProtectedApiRoute('/api/products','manager',async request => {
  const session = requireApiSession(request,'manager'); if (session instanceof Response) return session;
  try { return Response.json(await saveProductOperation(await request.json(),session.displayName),{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { if(error instanceof ProductInputError || error instanceof SyntaxError) return Response.json({error:error.message},{status:400}); throw error; }
});

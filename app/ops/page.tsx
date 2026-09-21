import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Management" };

export default async function OpsPage() {
  const session = await requirePageSession("/ops", "manager");
  return <OpsDashboard role={session.role} businessDate={await getActiveBusinessDate()} />;
}

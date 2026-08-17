import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  await requirePageSession("/ops", "manager");
  return <OpsDashboard businessDate={await getActiveBusinessDate()} />;
}

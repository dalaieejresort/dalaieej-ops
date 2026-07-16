import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  return <OpsDashboard businessDate={await getActiveBusinessDate()} />;
}

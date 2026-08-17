import { WaiterApp } from "@/components/waiter/WaiterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function WaiterPage() {
  const session = await requirePageSession("/waiter", "waiter");

  return (
    <WaiterApp
      businessDate={await getActiveBusinessDate()}
      authenticatedStaffName={session.displayName}
    />
  );
}

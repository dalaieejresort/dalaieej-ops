import { KitchenDisplay } from "@/components/kitchen/KitchenDisplay";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  const session = await requirePageSession("/kitchen", "kitchen");

  return (
    <KitchenDisplay
        role={session.role}
      businessDate={await getActiveBusinessDate()}
      authenticatedStaffName={session.displayName}
    />
  );
}

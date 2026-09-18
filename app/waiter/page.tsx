import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Waiter" };

export default async function WaiterPage() {
  const session = await requirePageSession("/waiter", "waiter");

  return (
    <RegisterApp
      title="Зөөгч"
      layout="phone"
      role={session.role}
      businessDate={await getActiveBusinessDate()}
      authenticatedStaffName={session.displayName}
    />
  );
}

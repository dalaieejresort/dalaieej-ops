import { RegisterApp } from "@/components/register/RegisterApp";
import { WaiterApp } from "@/components/waiter/WaiterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePageSession("/", "waiter");
  const businessDate = await getActiveBusinessDate();

  if (session.role === "waiter") {
    return (
      <WaiterApp
        businessDate={businessDate}
        authenticatedStaffName={session.displayName}
      />
    );
  }

  return (
    <RegisterApp
      businessDate={businessDate}
      authenticatedStaffName={session.displayName}
      role={session.role}
    />
  );
}

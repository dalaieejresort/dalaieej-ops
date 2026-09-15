import { KitchenDisplay } from "@/components/kitchen/KitchenDisplay";
import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePageSession("/", "any");
  const businessDate = await getActiveBusinessDate();

  if (session.role === "kitchen") {
    return (
      <KitchenDisplay
        businessDate={businessDate}
        authenticatedStaffName={session.displayName}
      />
    );
  }

  return (
    <RegisterApp
      title={session.role === "waiter" ? "Зөөгч" : "Касс"}
      layout={session.role === "waiter" ? "phone" : "adaptive"}
      businessDate={businessDate}
      authenticatedStaffName={session.displayName}
      role={session.role}
    />
  );
}

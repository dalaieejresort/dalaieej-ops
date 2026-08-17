import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requirePageSession("/");
  return (
    <RegisterApp
      businessDate={await getActiveBusinessDate()}
      authenticatedStaffName={session.displayName}
      role={session.role}
    />
  );
}

import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const session = await requirePageSession("/register");
  return (
    <RegisterApp
      businessDate={await getActiveBusinessDate()}
      authenticatedStaffName={session.displayName}
      role={session.role}
    />
  );
}

import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  return <RegisterApp businessDate={await getActiveBusinessDate()} />;
}

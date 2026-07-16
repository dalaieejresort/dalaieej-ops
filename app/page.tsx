import { ResponsiveHome } from "@/components/home/ResponsiveHome";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <ResponsiveHome businessDate={await getActiveBusinessDate()} />;
}

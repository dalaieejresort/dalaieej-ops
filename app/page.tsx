import { RegisterApp } from "@/components/register/RegisterApp";

export const dynamic = "force-dynamic";

export default function Home() {
  const businessDate = new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replace(/\//g, ".");

  return <RegisterApp businessDate={businessDate} />;
}

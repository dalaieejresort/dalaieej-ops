import type { Metadata } from "next";
import { site } from "@/lib/site-branding";
import { KitchenDisplay } from "@/components/kitchen/KitchenDisplay";
import { RegisterApp } from "@/components/register/RegisterApp";
import { getActiveBusinessDate } from "@/lib/server/active-business-date";
import { getServerSession, requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getServerSession();
  const section = session?.role === "kitchen" ? "Kitchen" : session?.role === "waiter" ? "Waiter" : "POS";
  // Root pages do not inherit the title template from their own root layout.
  return { title: { absolute: `${section} · ${site.name}` } };
}

export default async function Home() {
  const session = await requirePageSession("/", "any");
  const businessDate = await getActiveBusinessDate();

  if (session.role === "kitchen") {
    return (
      <KitchenDisplay
        role={session.role}
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

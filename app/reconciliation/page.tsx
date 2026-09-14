import type { Metadata } from "next";
import { ReconciliationInbox } from "@/components/reconciliation/ReconciliationInbox";
import {
  getReconciliationDashboard,
  getReconciliationSetup,
} from "@/lib/reconciliation/database";
import type { ReconciliationDashboard } from "@/lib/reconciliation/types";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Баримтын тулгалт",
  description: "Банкны мэдэгдэл болон баримтын тулгалт",
};

function ulaanbaatarDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  await requirePageSession("/reconciliation", "owner");
  const query = await searchParams;
  const requestedDate =
    typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
      ? query.date
      : ulaanbaatarDate();
  let loadError: string | null = null;
  let dashboard: ReconciliationDashboard;

  try {
    dashboard = await getReconciliationDashboard(requestedDate);
  } catch {
    const setup = getReconciliationSetup();
    dashboard = {
      setup,
      connections: [],
      connection: null,
      summary: {
        total: 0,
        awaitingReceipt: 0,
        candidates: 0,
        matched: 0,
        exceptions: 0,
      },
      events: [],
      supportingDocuments: [],
    };
    loadError = "Тулгалтын мэдээллийн сантай холбогдож чадсангүй.";
  }

  return (
    <ReconciliationInbox
      dashboard={dashboard}
      initialDate={requestedDate}
      loadError={loadError}
    />
  );
}

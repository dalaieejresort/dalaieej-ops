import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  await requirePageSession("/ops", "manager");
  redirect("/register?tab=day-close");
}

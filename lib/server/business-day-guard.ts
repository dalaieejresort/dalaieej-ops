import "server-only";

import { NextResponse } from "next/server";
import { getUlaanbaatarBusinessDate } from "@/lib/pos/business-date";

export function staleBusinessDayResponse(activeBusinessDate: string) {
  const currentBusinessDate = getUlaanbaatarBusinessDate();
  if (activeBusinessDate === currentBusinessDate) return null;

  return NextResponse.json(
    {
      error: `${activeBusinessDate} өдрийн касс нээлттэй хэвээр байна. Шинэ гүйлгээ хийхийн өмнө менежер тухайн өдрийг хаана уу.`,
      code: "STALE_BUSINESS_DAY",
      activeBusinessDate,
      currentBusinessDate,
    },
    { status: 409 },
  );
}

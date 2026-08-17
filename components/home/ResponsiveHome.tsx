"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { OpsRole } from "@/lib/auth-types";

type ResponsiveMode = "mobile" | "desktop";

type ResponsiveHomeProps = {
  businessDate: string;
  authenticatedStaffName: string;
  role: OpsRole;
};

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

function AppLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f5f7fb] px-6 text-center text-sm font-black text-[#64748b]">
      Dalai Eej
    </div>
  );
}

const MobileApp = dynamic(
  () =>
    import("@/components/mobile/MobileApp").then(
      (module) => module.MobileApp,
    ),
  { loading: AppLoading },
);

const RegisterApp = dynamic(
  () =>
    import("@/components/register/RegisterApp").then(
      (module) => module.RegisterApp,
    ),
  { loading: AppLoading },
);

export function ResponsiveHome({
  businessDate,
  authenticatedStaffName,
  role,
}: ResponsiveHomeProps) {
  const [mode, setMode] = useState<ResponsiveMode | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncMode = () => {
      setMode(mediaQuery.matches ? "desktop" : "mobile");
    };

    syncMode();
    mediaQuery.addEventListener("change", syncMode);

    return () => mediaQuery.removeEventListener("change", syncMode);
  }, []);

  if (mode === null) {
    return <AppLoading />;
  }

  return mode === "desktop" ? (
    <RegisterApp
      businessDate={businessDate}
      authenticatedStaffName={authenticatedStaffName}
      role={role}
    />
  ) : (
    <MobileApp businessDate={businessDate} />
  );
}

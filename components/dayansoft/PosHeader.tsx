"use client";

import type { AppView } from "@/lib/pos/types";

interface PosHeaderProps {
  view: AppView;
  tableLabel?: string;
  elapsed?: string;
  onNavigate: (view: AppView) => void;
  onOpenActions: () => void;
}

export function PosHeader({
  view,
  tableLabel,
  elapsed = "9:52",
  onNavigate,
  onOpenActions,
}: PosHeaderProps) {
  const today = new Date().toLocaleDateString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (
    <header className="flex h-11 shrink-0 items-center justify-between bg-[#2b2b2b] px-3 text-white">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-lg text-[#f5a623]">▶</span>
          <span className="text-lg font-semibold tracking-tight text-[#ddd]">
            Dalai Eej POS
          </span>
        </div>
        {view === "pos" ? (
          <span className="hidden text-sm text-[#ccc] sm:inline">
            Нээсэн: {today.replace(/\//g, ".")}
          </span>
        ) : (
          <span className="text-sm text-[#ccc]">
            Dalai Eej Resort · {today.replace(/\//g, ".")}
          </span>
        )}
      </div>

      <nav className="flex items-center gap-1 text-sm">
        <HeaderLink
          active={view === "orders"}
          onClick={() => onNavigate("orders")}
        >
          Шинэ
        </HeaderLink>
        <HeaderLink active={view === "pos"} onClick={() => onNavigate("pos")}>
          Бараа
        </HeaderLink>
        <HeaderLink
          active={view === "orders"}
          onClick={() => onNavigate("orders")}
        >
          Захиалга
        </HeaderLink>
        {view === "pos" && tableLabel && (
          <button
            type="button"
            className="mx-2 rounded border border-[#555] bg-[#3a3a3a] px-3 py-1 text-sm hover:bg-[#444]"
          >
            {tableLabel} ({elapsed})
          </button>
        )}
        <HeaderLink active={false} onClick={() => {}}>
          Борлуулалт
        </HeaderLink>
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenActions}
          className="flex items-center gap-1 rounded border border-[#555] bg-[#3a3a3a] px-3 py-1 text-sm hover:bg-[#444]"
        >
          Үйлдэл <span className="text-xs">▼</span>
        </button>
        <span className="hidden text-sm text-[#ccc] md:inline">Батболд</span>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded bg-[#f5a623] text-xs text-black"
          aria-label="Түгжих"
        >
          🔒
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded bg-[#3b9dd4] text-xs"
          aria-label="Тусламж"
        >
          ?
        </button>
      </div>
    </header>
  );
}

function HeaderLink({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 transition-colors ${
        active
          ? "text-white underline decoration-[#3b9dd4] underline-offset-4"
          : "text-[#aaa] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

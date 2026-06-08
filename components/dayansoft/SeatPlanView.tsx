"use client";

import { useState } from "react";
import { TABLES, ZONE_TABS } from "@/lib/pos/data";
import type { TableDef } from "@/lib/pos/types";

interface SeatPlanViewProps {
  onSelectTable: (table: TableDef) => void;
}

export function SeatPlanView({ onSelectTable }: SeatPlanViewProps) {
  const [activeZone, setActiveZone] = useState("all");

  const visibleTables =
    activeZone === "all"
      ? TABLES
      : TABLES.filter((t) => t.zone === activeZone);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-[#999]">
        {ZONE_TABS.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => setActiveZone(zone.id)}
            className={`shrink-0 border-r border-[#888] px-5 py-2 text-sm font-semibold text-white transition-opacity ${
              activeZone === zone.id ? "opacity-100 ring-2 ring-inset ring-white/40" : "opacity-80"
            }`}
            style={{ backgroundColor: zone.color }}
          >
            {zone.label}
            <span className="ml-2 font-normal opacity-90">
              {zone.occupied}/{zone.total}
            </span>
          </button>
        ))}
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-auto"
        style={{
          backgroundColor: "#c4a882",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div className="relative min-h-[500px] w-full min-w-[600px]">
          {visibleTables.map((table) => (
            <button
              key={table.id}
              type="button"
              onClick={() => onSelectTable(table)}
              className="absolute flex items-center justify-center border border-black/20 text-sm font-bold text-[#333] shadow-md transition-transform active:scale-95"
              style={{
                left: `${table.x}%`,
                top: `${table.y}%`,
                width: `${table.w}%`,
                height: `${table.h}%`,
                backgroundColor: table.color,
                borderRadius:
                  table.shape === "circle"
                    ? "50%"
                    : table.shape === "bar"
                      ? "4px"
                      : "6px",
              }}
            >
              {table.badge && (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
                  {table.badge}
                </span>
              )}
              {table.label}
            </button>
          ))}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-[#bbb] bg-[#ddd] px-4 py-1 text-xs text-[#555]">
        <span>Dalai Eej POS / Restaurant</span>
        <span>
          {new Date().toLocaleString("mn-MN", {
            timeZone: "Asia/Ulaanbaatar",
          })}{" "}
          · v1.0.0
        </span>
      </footer>
    </div>
  );
}

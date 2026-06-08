"use client";

import { TABLE_ORDERS } from "@/lib/pos/data";
import { formatMNT } from "@/lib/pos/utils";
import type { TableOrder } from "@/lib/pos/types";

interface OrderGridViewProps {
  onSelectOrder: (order: TableOrder) => void;
}

export function OrderGridView({ onSelectOrder }: OrderGridViewProps) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#e8e8e8] p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {TABLE_ORDERS.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() => onSelectOrder(order)}
            className={`relative flex min-h-[130px] flex-col rounded-lg border border-black/10 p-3 text-left shadow-sm transition-transform active:scale-[0.98] ${
              order.isSubOrder
                ? "bg-[#e8a04c] text-white"
                : order.amount > 0
                  ? "bg-[#5ba4b8] text-white"
                  : "bg-[#5ba4b8] text-white"
            }`}
          >
            <span className="text-lg font-bold">{order.label}</span>
            {order.amount > 0 && (
              <>
                <span className="mt-2 text-2xl font-bold">
                  {formatMNT(order.amount)}
                </span>
                {order.orderCount ? (
                  <span className="mt-1 text-sm opacity-90">
                    Захиалга: ({order.orderCount})
                  </span>
                ) : (
                  <span className="mt-1 text-sm opacity-90">
                    {order.staff}
                  </span>
                )}
              </>
            )}
            <span className="mt-auto pt-3 text-center text-sm font-mono opacity-80">
              {order.elapsed}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { ACTION_ITEMS } from "@/lib/pos/data";

interface ActionModalProps {
  onClose: () => void;
  onAction: (id: string) => void;
}

export function ActionModal({ onClose, onAction }: ActionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-4xl rounded bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#ddd] px-4 py-3">
          <h2 className="text-lg font-bold">Үйлдэл</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded hover:bg-[#f0f0f0]"
            aria-label="Хаах"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 md:grid-cols-6">
          {ACTION_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onAction(item.id)}
              className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded border border-[#ccc] bg-white p-2 text-center text-[10px] font-semibold leading-tight text-[#444] hover:bg-[#f5f5f5] active:scale-[0.98]"
            >
              <span className="text-2xl text-[#888]">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-[#ddd] px-4 py-2 text-xs text-[#888]">
          <span>PosId: 101315740</span>
          <span>Dalai Eej POS</span>
        </div>

      </div>
    </div>
  );
}

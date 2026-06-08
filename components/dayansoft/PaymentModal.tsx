"use client";

import { useState } from "react";
import { PAYMENT_METHODS } from "@/lib/pos/data";
import { formatNumber } from "@/lib/pos/utils";

interface PaymentModalProps {
  total: number;
  onClose: () => void;
  onConfirm: (method: string) => void;
}

export function PaymentModal({ total, onClose, onConfirm }: PaymentModalProps) {
  const [selected, setSelected] = useState("epos");
  const [showError, setShowError] = useState(false);
  const [paid, setPaid] = useState(total);

  function handleSelect(id: string) {
    setSelected(id);
    setPaid(total);
  }

  function handleConfirm() {
    if (selected === "epos") {
      setShowError(true);
      return;
    }
    onConfirm(selected);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl overflow-hidden rounded border border-[#bbb] bg-white shadow-2xl">
        <div className="flex w-1/2 flex-col border-r border-[#ccc]">
          <div className="flex-1 overflow-y-auto">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => handleSelect(method.id)}
                className={`flex w-full items-center justify-between border-b border-[#ddd] px-4 py-3 text-left text-sm ${
                  selected === method.id
                    ? "bg-[#555] text-white"
                    : "bg-white hover:bg-[#f5f5f5]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{method.icon}</span>
                  <span>+ {method.label}</span>
                </span>
                {selected === method.id && (
                  <span className="text-lg font-bold">
                    {formatNumber(paid)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-[#ccc] bg-[#f9f9f9] p-3 text-sm">
            <div className="flex justify-between py-1">
              <span>Нийт төлсөн</span>
              <span className="font-bold">{formatNumber(paid)}</span>
            </div>
            <div className="flex justify-between py-1 text-[#888]">
              <span>Үлдэгдэл</span>
              <span>0</span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-[#666]">
              <input type="checkbox" />
              Принтерээр хэвлэхгүй дэлгэцээр харах
            </label>
          </div>
        </div>

        <div className="relative flex w-1/2 flex-col bg-[#f0f0f0] p-4">
          <div className="grid flex-1 grid-cols-2 gap-2 content-start">
            {[
              "QR pay",
              "Бэлгийн карт (F7)",
              "Гишүүнчлэл карт (F8)",
              "Харилцагч (F9)",
              "Байгууллагаар",
              "Хувь хүнээр",
              "И-Баримт хэвлэх (F11)",
              "И-Баримт хэвлэх (F12)",
            ].map((label) => (
              <button
                key={label}
                type="button"
                className="rounded border border-[#ccc] bg-white px-2 py-4 text-center text-xs text-[#888]"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            className="mt-4 w-full rounded bg-[#3b9dd4] py-3 font-bold text-white hover:bg-[#2d8fc8]"
          >
            Батлах
          </button>
        </div>
      </div>

      {showError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-md rounded border-2 border-red-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#eee] px-4 py-3">
              <span className="font-bold">Алдааны мэдээлэл</span>
              <span className="text-xs text-[#888]">
                {new Date().toLocaleString("mn-MN", {
                  timeZone: "Asia/Ulaanbaatar",
                })}{" "}
                | v1.0.0
              </span>
            </div>
            <p className="px-4 py-8 text-center text-lg">
              Интернетгүй байна!
            </p>
            <div className="flex justify-end border-t border-[#eee] p-3">
              <button
                type="button"
                onClick={() => setShowError(false)}
                className="rounded bg-[#e8917a] px-8 py-2 font-semibold text-white hover:bg-[#d8806a]"
              >
                Хаах
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-lg hover:bg-[#f0f0f0]"
        aria-label="Хаах"
      >
        ×
      </button>
    </div>
  );
}

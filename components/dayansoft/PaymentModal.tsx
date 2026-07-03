"use client";

import { useState } from "react";
import { PAYMENT_METHODS } from "@/lib/pos/data";
import { formatNumber } from "@/lib/pos/utils";
import type { PaymentAllocation } from "@/lib/pos/types";

interface PaymentModalProps {
  total: number;
  onClose: () => void;
  onConfirm: (payments: PaymentAllocation[]) => void;
}

function parseMoney(value: string) {
  const amount = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

export function PaymentModal({ total, onClose, onConfirm }: PaymentModalProps) {
  const [selected, setSelected] = useState("cash");
  const [amountInput, setAmountInput] = useState(() => formatNumber(total));
  const [payments, setPayments] = useState<PaymentAllocation[]>([]);
  const [error, setError] = useState("");

  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(total - paid, 0);
  const draftAmount = parseMoney(amountInput);

  function handleSelect(id: string) {
    setSelected(id);
    setAmountInput(formatNumber(remaining || total));
    setError("");
  }

  function getMethodLabel(id: string) {
    return PAYMENT_METHODS.find((method) => method.id === id)?.label ?? id;
  }

  function getMethodPaid(id: string) {
    return payments
      .filter((payment) => payment.method === id)
      .reduce((sum, payment) => sum + payment.amount, 0);
  }

  function addPaymentLine() {
    if (draftAmount <= 0) {
      setError("Төлөх дүн оруулна уу");
      return;
    }
    if (draftAmount > remaining) {
      setError("Төлөх дүн үлдэгдлээс их байна");
      return;
    }

    const methodLabel = getMethodLabel(selected);
    setPayments((current) => [
      ...current,
      {
        method: selected,
        label: methodLabel,
        amount: draftAmount,
        cashReceived: selected === "cash" ? draftAmount : undefined,
        changeDue: selected === "cash" ? 0 : undefined,
      },
    ]);
    setAmountInput(formatNumber(Math.max(remaining - draftAmount, 0)));
    setError("");
  }

  function removePaymentLine(index: number) {
    setPayments((current) => current.filter((_, lineIndex) => lineIndex !== index));
    setError("");
  }

  function handleConfirm() {
    const finalPayments =
      payments.length > 0
        ? payments
        : [
            {
              method: selected,
              label: getMethodLabel(selected),
              amount: total,
              cashReceived: selected === "cash" ? total : undefined,
              changeDue: selected === "cash" ? 0 : undefined,
            },
          ];
    const finalPaid = finalPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (finalPaid !== total) {
      setError(`${formatNumber(Math.abs(total - finalPaid))} ₮ зөрүүтэй байна`);
      return;
    }

    onConfirm(finalPayments);
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
                {(selected === method.id || getMethodPaid(method.id) > 0) && (
                  <span className="text-lg font-bold">
                    {formatNumber(getMethodPaid(method.id) || draftAmount)}
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
            <div className={`flex justify-between py-1 ${remaining > 0 ? "text-[#b45309]" : "text-[#16803c]"}`}>
              <span>Үлдэгдэл</span>
              <span>{formatNumber(remaining)}</span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-[#666]">
              <input type="checkbox" />
              Баримт хэвлэхгүй, дэлгэцээр харах
            </label>
          </div>
        </div>

        <div className="relative flex w-1/2 flex-col bg-[#f0f0f0] p-4">
          <div className="mb-3 rounded border border-[#ccc] bg-white p-3">
            <div className="mb-2 flex items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-xs font-bold text-[#666]">
                  Энэ мөрийн дүн
                </span>
                <input
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setError("");
                  }}
                  inputMode="numeric"
                  className="h-11 w-full rounded border border-[#bbb] px-3 text-right text-lg font-bold outline-none focus:border-[#3b9dd4]"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setAmountInput(formatNumber(remaining));
                  setError("");
                }}
                className="h-11 rounded border border-[#aaa] bg-[#f7f7f7] px-3 text-xs font-bold hover:bg-white"
              >
                Үлдэгдэл
              </button>
            </div>
            <button
              type="button"
              onClick={addPaymentLine}
              disabled={remaining <= 0}
              className="w-full rounded bg-[#555] py-2 text-sm font-bold text-white hover:bg-[#444] disabled:bg-[#aaa]"
            >
              Мөр нэмэх
            </button>

            {payments.length > 0 && (
              <div className="mt-3 divide-y divide-[#eee] rounded border border-[#ddd]">
                {payments.map((payment, index) => (
                  <div
                    key={`${payment.method}-${index}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{payment.label}</span>
                    <span className="ml-auto font-bold">
                      {formatNumber(payment.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePaymentLine(index)}
                      className="rounded border border-[#fca5a5] px-2 py-1 text-xs font-bold text-[#b91c1c] hover:bg-[#fff1f2]"
                    >
                      Хасах
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="grid flex-1 grid-cols-2 gap-2 content-start">
            {[
              "Данс",
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

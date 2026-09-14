"use client";

import { useState } from "react";

export function ReconciliationInstallPrompt() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="reconciliation-install-button inline-flex min-h-10 items-center justify-center  border border-[#8c8c8c] bg-white px-4 text-xs font-normal text-black sm:hidden"
      >
        iPhone-д нэмэх
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[200] flex items-end bg-black/45 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-reconciliation-title"
          onClick={() => setOpen(false)}
        >
          <section
            className="w-full  bg-white p-6 text-[#18201d] "
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1.5 w-12  bg-slate-200" />
            <p className="text-xs font-normal uppercase tracking-[0.18em] text-[#666666]">
              iPhone-оос хурдан нэвтрэх
            </p>
            <h2 id="install-reconciliation-title" className="mt-2 text-2xl font-normal">
              Тулгалтыг үндсэн дэлгэцэд нэмэх
            </h2>
            <ol className="mt-5 space-y-4 text-sm font-normal leading-6 text-slate-700">
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center  bg-[#f5f5f5] text-black">1</span>
                Энэ хуудсыг Safari-д нээнэ үү.
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center  bg-[#f5f5f5] text-black">2</span>
                Safari-ийн доод хэсгийн хуваалцах товчийг дарна уу.
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center  bg-[#f5f5f5] text-black">3</span>
                “Үндсэн дэлгэцэд нэмэх” (Add to Home Screen)-ийг сонгоод “Нэмэх”-ийг дарна уу.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-6 min-h-12 w-full  bg-[#D2042D] px-5 text-sm font-normal text-white"
            >
              Ойлголоо
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

"use client";

interface FilterBarProps {
  onSeatPlan: () => void;
  onRefresh: () => void;
}

export function FilterBar({ onSeatPlan, onRefresh }: FilterBarProps) {
  const today = new Date().toLocaleDateString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, ".");

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#ccc] bg-white px-3 py-2">
      <select className="h-9 rounded border border-[#bbb] bg-white px-2 text-sm">
        <option>Төлөв</option>
        <option>Биелсэн</option>
        <option>Цуцалсан</option>
      </select>
      <select className="h-9 rounded border border-[#bbb] bg-white px-2 text-sm">
        <option>Tags</option>
      </select>
      <div className="flex h-9 items-center rounded border border-[#bbb] bg-white px-2">
        <span className="text-[#888]">🔍</span>
        <input
          type="search"
          placeholder="Хайх"
          className="ml-1 w-24 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mx-2 flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={today}
          className="h-9 w-28 rounded border border-[#bbb] bg-white px-2 text-center text-sm"
        />
        <input
          type="text"
          readOnly
          value={today}
          className="h-9 w-28 rounded border border-[#bbb] bg-white px-2 text-center text-sm"
        />
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-9 items-center gap-1 rounded border border-[#bbb] bg-white px-3 text-sm hover:bg-[#f5f5f5]"
        >
          <span className="text-[#3b9dd4]">↻</span> Харах
        </button>
      </div>

      <div className="ml-auto flex gap-1">
        <IconBtn label="Байршил">📍</IconBtn>
        <IconBtn label="Дэлгэц">⛶</IconBtn>
        <IconBtn label="Жагсаалт">☰</IconBtn>
        <IconBtn label="Ширээний төлөвлөгөө" onClick={onSeatPlan}>
          ✏
        </IconBtn>
        <IconBtn label="Нэмэх">＋</IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded border border-[#bbb] bg-white text-sm hover:bg-[#f0f0f0]"
    >
      {children}
    </button>
  );
}

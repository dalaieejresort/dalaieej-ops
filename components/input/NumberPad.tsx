"use client";

import styles from "./NumberPad.module.css";

export function NumberPad({ value, onChange, onDone, label = "Тоон гар", maxLength = 32, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  onDone?: () => void;
  label?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return <div className={styles.pad} role="group" aria-label={label}>
    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Арилгах", "0", "⌫"].map(key =>
      <button key={key} type="button" disabled={disabled} aria-label={key === "⌫" ? "Сүүлийн цифрийг устгах" : key}
        onClick={() => onChange(key === "Арилгах" ? "" : key === "⌫" ? value.slice(0, -1) : (value + key).slice(0, maxLength))}>
        {key}
      </button>)}
    {onDone && <button type="button" className={styles.done} disabled={disabled} onClick={onDone}>Болсон</button>}
  </div>;
}

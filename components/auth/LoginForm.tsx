"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="mt-8 grid gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        setError("");

        try {
          const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          if (!response.ok) {
            throw new Error(payload?.error || "Нэвтэрч чадсангүй.");
          }

          router.replace(nextPath);
          router.refresh();
        } catch (loginError) {
          setError(
            loginError instanceof Error ? loginError.message : "Нэвтэрч чадсангүй.",
          );
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label className="grid gap-2 text-sm font-black text-[#334155]">
        Хэрэглэгчийн нэр
        <input
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="h-12 rounded-xl border border-[#cbd5e1] px-4 text-base font-semibold text-[#111827] outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
        />
      </label>
      <label className="grid gap-2 text-sm font-black text-[#334155]">
        Нууц үг
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-12 rounded-xl border border-[#cbd5e1] px-4 text-base font-semibold text-[#111827] outline-none focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm font-bold text-[#b91c1c]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="h-12 rounded-xl bg-[#047857] text-base font-black text-white hover:bg-[#065f46] disabled:bg-[#94a3b8]"
      >
        {submitting ? "Шалгаж байна…" : "Нэвтрэх"}
      </button>
    </form>
  );
}

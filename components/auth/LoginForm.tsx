"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./Auth.module.css";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className={styles.form}
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
      <label className={styles.label}>
        Хэрэглэгчийн нэр
        <input
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className={styles.input}
        />
      </label>
      <label className={styles.label}>
        Нууц үг
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={styles.input}
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className={styles.primaryButton}
      >
        {submitting ? "Шалгаж байна…" : "Нэвтрэх"}
      </button>
    </form>
  );
}

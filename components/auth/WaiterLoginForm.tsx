"use client";

import Link from "next/link";
import { useState } from "react";
import { NumberPad } from "@/components/input/NumberPad";
import styles from "./Auth.module.css";

export function WaiterLoginForm({ waiters }: { waiters: { username: string; displayName: string }[] }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    if (!username || pin.length !== 4 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: pin }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Нэвтэрч чадсангүй.");
      // A full navigation also discards the previous person's in-memory order state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/waiter");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Холболтоо шалгаад дахин оролдоно уу.");
      setSubmitting(false);
      setPin("");
    }
  }
  return <form className={styles.form} onSubmit={event => { event.preventDefault(); void signIn(); }}>
    <fieldset className={styles.staffList} disabled={submitting}>
      <legend>Өөрийн нэрийг сонгоно уу</legend>
      {waiters.map(waiter => <label key={waiter.username} className={styles.staffOption}>
        <input type="radio" name="waiter" value={waiter.username} checked={username === waiter.username}
          onChange={() => { setUsername(waiter.username); setPin(""); setError(""); }} />
        {waiter.displayName}
      </label>)}
      {waiters.length === 0 && <p>Зөөгчдийн нэрс хараахан бүртгэгдээгүй байна.</p>}
    </fieldset>
    {username && <div>
      <label className={styles.label}>4 оронтой ПИН
        <input className={styles.input} type="password" inputMode="none" autoComplete="off"
          value={pin} maxLength={4} readOnly disabled={submitting} />
      </label>
      <NumberPad label="ПИН оруулах тоон гар" value={pin} onChange={setPin} maxLength={4} disabled={submitting} />
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button className={styles.primaryButton} disabled={!username || pin.length !== 4 || submitting}>
      {submitting ? "Шалгаж байна…" : "Нэвтрэх"}
    </button>
    <Link href="/login?method=password&next=%2Fwaiter">Касс / менежер / эзэмшигчээр нэвтрэх</Link>
  </form>;
}

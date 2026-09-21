'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canRefreshInBackground, fetchWithTimeout } from '@/lib/client/network';
import type { DataQualityReport } from '@/lib/data-quality-types';
import { needsOperationalAttention, type PendingOperation } from '@/lib/pos/operational-checks';
import styles from './OperationalChecks.module.css';

export function OperationalChecks() {
  const [quality, setQuality] = useState<DataQualityReport | null>(null);
  const [pending, setPending] = useState<PendingOperation[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async (fresh = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const read = async (path: string) => {
      const response = await fetchWithTimeout(`${path}${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Шалгалтыг ачаалж чадсангүй.');
      return payload;
    };
    try {
      const results = await Promise.allSettled([read('/api/data-quality'), read('/api/operations')]);
      if (!mounted.current) return;
      const failures: string[] = [];
      if (results[0].status === 'fulfilled' && results[0].value?.summary && Array.isArray(results[0].value.checks)) setQuality(results[0].value);
      else failures.push('Өгөгдлийн шалгалтыг шинэчилж чадсангүй.');
      if (results[1].status === 'fulfilled' && Array.isArray(results[1].value?.pending)) setPending(results[1].value.pending);
      else failures.push('Дуусаагүй ажиллагааг шалгаж чадсангүй.');
      setErrors(failures);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initial = window.setTimeout(() => void refresh(), 0);
    const check = () => { if (canRefreshInBackground()) void refresh(); };
    const show = () => { setOpen(true); void refresh(); };
    const timer = window.setInterval(check, 60000);
    window.addEventListener('online', check);
    window.addEventListener('pos:open-checks', show);
    document.addEventListener('visibilitychange', check);
    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('pos:open-checks', show);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refresh]);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  async function repair() {
    setRepairing(true);
    setMessage('');
    try {
      const response = await fetchWithTimeout('/api/data-quality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 30000);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Барааны мөрүүдийг нөхөж чадсангүй.');
      setMessage(`${result.ordersBackfilled ?? 0} захиалгын ${result.linesBackfilled ?? 0} барааны мөр нөхөгдлөө.`);
      await refresh(true);
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Нөхөх үйлдэл амжилтгүй боллоо.');
    } finally { setRepairing(false); }
  }

  const attention = needsOperationalAttention(quality, pending ?? [], errors);
  return <>
    {attention && <button type="button" className={styles.alert} onClick={() => setOpen(true)} aria-label="Шалгах шаардлагатай ажиллагаа · Дэлгэрэнгүй">Анхаар!</button>}
    {open && createPortal(
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="operations-check-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
        <header><h2 id="operations-check-title">Өгөгдөл ба хадгалалтын шалгалт</h2><button type="button" onClick={() => setOpen(false)}>Хаах</button></header>
        <div className={styles.body}>
          <p>Бүх өдрийн идэвхтэй бүртгэлийг шалгана.</p>
          <button type="button" disabled={loading || repairing} onClick={() => void refresh(true)}>{loading ? 'Шалгаж байна…' : 'Дахин шалгах'}</button>
          {errors.map(error => <p key={error} role="alert">{error} Харагдаж буй мэдээлэл хуучирсан байж болно.</p>)}
          {!quality && !errors.length && <p>Шалгаж байна…</p>}
          {quality && <section>
            <h3>{errors.length > 0 ? 'Өмнөх өгөгдлийн шалгалт' : quality.status === 'healthy' ? 'Өгөгдлийн шалгалт хэвийн' : `${quality.summary.issueCount} зөрчил илэрсэн`}</h3>
            <p className={styles.muted}>Шалгасан: {new Date(quality.checkedAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })}</p>
            <ul>{quality.checks.map(check => <li key={check.id}><div><span>{check.label}</span><strong>{check.count}</strong></div><p className={styles.muted}>{check.detail}</p></li>)}</ul>
            {quality.summary.repairableOrders > 0 && <button type="button" disabled={repairing || loading} onClick={() => void repair()}>{repairing ? 'Нөхөж байна…' : `${quality.summary.repairableOrders} захиалгын дутуу мөрийг нөхөх`}</button>}
          </section>}
          <section><h3>Дуусаагүй ажиллагаа{pending && ` · ${pending.length}`}</h3>
            {!pending ? <p>Мэдээлэл ачаалагдаагүй.</p> : !pending.length ? <p>Дуусаагүй ажиллагаа бүртгэгдээгүй.</p> : <ul>{pending.map((operation, index) => <li key={`${operation.type}-${operation.requestId}-${operation.resourceId}-${index}`}>
              <p>{operation.resourceId || operation.requestId || 'Дугааргүй ажиллагаа'}</p>
              <p className={styles.muted}>{operation.businessDate} · {operation.actor}</p>
              {operation.error && <p>{operation.error}</p>}
              <p>{operation.recoverable ? 'Анхны үйлдлийг дахин хадгалахад үргэлжлүүлнэ.' : 'Менежер шалгах шаардлагатай.'}</p>
            </li>)}</ul>}
          </section>
          {message && <p role="status">{message}</p>}
        </div>
      </dialog>, document.body
    )}
  </>;
}

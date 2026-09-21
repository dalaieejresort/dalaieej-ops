'use client';

import { useRef, useState } from 'react';
import { fetchWithTimeout } from '@/lib/client/network';
import styles from './Products.module.css';

type StockProduct = { sku: string; name: string; stock: number; tracked: boolean };

export function StockAdjustments({ products, loaded, onSaved }: {
  products: StockProduct[];
  loaded: boolean;
  onSaved: () => Promise<void>;
}) {
  const [sku, setSku] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const selected = products.find(product => product.sku === sku && product.tracked);

  async function save() {
    if (busy) return;
    setMessage('');
    setError('');
    const quantityDelta = Number(delta);
    if (!selected || !Number.isFinite(quantityDelta) || !quantityDelta || Math.abs(quantityDelta) > 1000000) {
      setError('Бараагаа сонгож, 0-ээс өөр зөрүү оруулна уу.');
      return;
    }
    if (!reason.trim()) {
      setError('Тооллогын тайлбараа заавал бичнэ үү.');
      return;
    }
    const adjustments = [{ sku: selected.sku, name: selected.name, quantityDelta }];
    const fingerprint = JSON.stringify({ adjustments, reason: reason.trim() });
    if (pending.current?.fingerprint !== fingerprint) {
      pending.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    setBusy(true);
    try {
      const response = await fetchWithTimeout('/api/inventory-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRequestId: pending.current.requestId, adjustments, reason: reason.trim() }),
      }, 30000);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Тохируулгыг хадгалж чадсангүй.');
      pending.current = null;
      setDelta('');
      setReason('');
      setMessage('Тооллогын тохируулга хадгалагдлаа.');
      try { await onSaved(); }
      catch { setError('Тохируулга хадгалагдсан боловч үлдэгдэл шинэчлэгдсэнгүй. Мэдээллээ шинэчилнэ үү.'); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Тохируулгыг хадгалж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.section}>
    <h2>Барааны тооллогын тохируулга</h2>
    <p className={styles.muted}>Тооллогоор гарсан зөрүүг нэмэх эсвэл хасах тоогоор оруулна. Кассын өдөр нээлттэй байх шаардлагатай. Өөрчлөлт бүр ажилтны нэр, шалтгаантай хадгалагдана.</p>
    <form className={styles.adjustmentForm} onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || !loaded}>
        <label>Тохируулах бараа
          <select required value={sku} onChange={event => setSku(event.target.value)}>
            <option value="">Бараа сонгох</option>
            {products.filter(product => product.tracked).map(product => <option key={product.sku} value={product.sku}>{product.name} · {product.sku} · {product.stock}</option>)}
          </select>
        </label>
        {selected && <p className={styles.muted}>Одоогийн үлдэгдэл: {selected.stock}</p>}
        <label>Зөрүү (+ нэмэх, − хасах)<input type="number" required min="-1000000" max="1000000" step="0.001" value={delta} onChange={event => setDelta(event.target.value)} /></label>
        <label>Тооллогын тайлбар<input required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button type="submit">{busy ? 'Хадгалж байна…' : 'Тохируулга хадгалах'}</button>
      </fieldset>
    </form>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

import { requirePageSession } from '@/lib/server/auth';
import { withPosTransaction } from '@/lib/server/pos-storage/transaction';
import { listPosArchives } from '@/lib/server/pos-archives';
import { ProductShell } from '@/components/products/ProductShell';
import styles from '@/components/products/Products.module.css';
export const dynamic='force-dynamic';
export const metadata={title:'Season archive'};
const labels:Record<string,string>={Sales_Log:'Sales / bills',Payments_Log:'Payments',Receipts_Log:'Receipts',Inventory_Log:'Stock movements',Day_Sessions:'Business days',Voids_Log:'Voids / refunds',Order_Items:'Order items',Merged_Sales_Data:'Historical sale lines'};
export default async function Page(){
 await requirePageSession('/archive','owner');const archives=await withPosTransaction(listPosArchives);
 return <ProductShell archive><header className={styles.title}><h1>Улирлын архив</h1><p>Season archive · 1 September–31 August · named by ending year</p></header><section className={styles.section}><p>Өмнөх борлуулалт, төлбөр, өр, буцаалт, барааны хөдөлгөөнийг өөрчлөлтгүй хадгалсан архив. Эндхийн дүн идэвхтэй касс, үлдэгдэлд орохгүй.</p><p className={styles.muted}>Archived records remain historical evidence, including unresolved SKU and reference issues. A reset does not mean old debts were paid or discrepancies resolved.</p></section>{archives.length===0?<section className={styles.section}>Архив хараахан үүсээгүй.</section>:archives.map(a=><section key={a.id} className={styles.section}><h2>{a.label}</h2><p className={styles.muted}>{a.start&&a.end?`${a.start} — ${a.end} · `:''}{a.records.toLocaleString('en-GB')} records · archived {a.createdAt.slice(0,10)}</p>{a.kind!=='full'&&<ul>{Object.entries(a.counts).filter(([,n])=>n>0).map(([name,count])=><li key={name}>{labels[name]||name}: {count.toLocaleString('en-GB')}</li>)}</ul>}<a className={styles.button} href={`/api/pos-archives?id=${encodeURIComponent(a.id)}`}>JSON архив татах / Download</a>{a.kind==='full'&&<p className={styles.muted}>Complete recovery snapshot, including catalogue, row counters and audit history.</p>}</section>)}</ProductShell>;
}

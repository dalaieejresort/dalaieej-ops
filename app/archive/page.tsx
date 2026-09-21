import { requirePageSession } from '@/lib/server/auth';
import { withPosTransaction } from '@/lib/server/pos-storage/transaction';
import { listPosArchives } from '@/lib/server/pos-archives';
import { ProductShell } from '@/components/products/ProductShell';
import styles from '@/components/products/Products.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Улирлын архив' };

const labels: Record<string, string> = {
  Sales_Log: 'Борлуулалт / төлбөрийн нэхэмжлэл',
  Payments_Log: 'Төлбөрүүд',
  Receipts_Log: 'Төлбөрийн баримтууд',
  Inventory_Log: 'Барааны хөдөлгөөн',
  Day_Sessions: 'Кассын өдрүүд',
  Voids_Log: 'Буцаалт / хүчингүй болгосон гүйлгээ',
  Order_Items: 'Захиалгын бараанууд',
  Merged_Sales_Data: 'Өмнөх борлуулалтын мөрүүд',
  Product_Operations: 'Барааны бүртгэлийн үйлдлүүд',
};

export default async function Page() {
  const session = await requirePageSession('/archive', 'owner');
  const archives = await withPosTransaction(listPosArchives);

  return (
    <ProductShell archive role={session.role}>
      <header className={styles.title}>
        <h1>Улирлын архив</h1>
        <p>Улирал: 9-р сарын 1-нээс дараа оны 8-р сарын 31 хүртэл · Дуусах оноор нэрлэнэ</p>
      </header>
      <section className={styles.section}>
        <p>Өмнөх борлуулалт, төлбөр, өр, буцаалт, барааны хөдөлгөөнийг өөрчлөлтгүй хадгалсан архив. Эндхийн дүн идэвхтэй касс, үлдэгдэлд орохгүй.</p>
        <p className={styles.muted}>SKU код болон баримтын холбоосын шийдэгдээгүй зөрчил архивт хэвээр хадгалагдана. Шинээр эхлүүлсэн нь өмнөх өр төлөгдсөн эсвэл зөрчил арилсан гэсэн үг биш.</p>
      </section>
      {archives.length === 0 ? (
        <section className={styles.section}>Архив хараахан үүсээгүй.</section>
      ) : archives.map(archive => (
        <section key={archive.id} className={styles.section}>
          <h2>{archive.kind === 'full'
            ? 'Шинээр эхлэхийн өмнөх бүрэн нөөц хуулбар'
            : archive.season === 'undated'
              ? 'Огноогүй өмнөх бүртгэлүүд'
              : /^\d{4}$/.test(archive.season)
                ? `${archive.season} оны улирал`
                : archive.label}</h2>
          <p className={styles.muted}>
            {archive.start && archive.end ? `${archive.start.replaceAll('-', '.')} — ${archive.end.replaceAll('-', '.')} · ` : ''}
            {archive.records.toLocaleString('mn-MN')} бүртгэл · Архивласан: {archive.createdAt.slice(0, 10).replaceAll('-', '.')}
          </p>
          {archive.kind !== 'full' && (
            <ul>
              {Object.entries(archive.counts).filter(([, count]) => count > 0).map(([name, count]) => (
                <li key={name}>{labels[name] || name}: {count.toLocaleString('mn-MN')}</li>
              ))}
            </ul>
          )}
          <a className={styles.button} href={`/api/pos-archives?id=${encodeURIComponent(archive.id)}`}>
            Архив татах (JSON)
          </a>
          {archive.kind === 'full' && (
            <p className={styles.muted}>Барааны жагсаалт, бүртгэлийн дугаарын тоолуур, өөрчлөлтийн түүхийг багтаасан бүрэн сэргээх нөөц хуулбар.</p>
          )}
        </section>
      ))}
    </ProductShell>
  );
}

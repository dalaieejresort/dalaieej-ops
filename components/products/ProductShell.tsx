import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './Products.module.css';
export function ProductShell({archive=false,children}:{archive?:boolean;children:ReactNode}) {
  return <div className={styles.workspace}><header className={styles.topbar}><Link href="/register">Dalai Eej / Operations</Link></header><nav className={styles.nav} aria-label="Operations navigation"><Link href="/register">Касс</Link><Link href="/ops">Удирдлага</Link><Link href="/products" aria-current={!archive?'page':undefined}>Бараа / Stock</Link><Link href="/archive" aria-current={archive?'page':undefined}>Улирлын архив</Link></nav><main className={styles.main}>{children}</main></div>;
}

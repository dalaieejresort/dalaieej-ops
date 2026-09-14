import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./ReceiptPayments.module.css";

const pages = [
  { id: "overview", label: "Overview", href: "/receipt-payments" },
  { id: "connect", label: "Gmail connection", href: "/receipt-payments/connect" },
  { id: "privacy", label: "Privacy policy", href: "/receipt-payments/privacy" },
] as const;

export default function ReceiptShell({ active, title, children }: {
  active: typeof pages[number]["id"];
  title: string;
  children: ReactNode;
}) {
  return (
    <div lang="en" className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/register" prefetch={false}>Dalai Eej Operations</Link>
        <span>Receipts · 2027</span>
      </header>
      <nav className={styles.rail} aria-label="Receipt pages">
        {pages.map((page, index) => (
          <Link key={page.id} href={page.href} prefetch={false}
            aria-current={active === page.id ? "page" : undefined}>
            <span aria-hidden="true">0{index + 1}</span>{page.label}
          </Link>
        ))}
      </nav>
      <main className={styles.main}>
        <div className={styles.titleBand}><h1>{title}</h1></div>
        <article className={styles.content}>{children}</article>
      </main>
    </div>
  );
}

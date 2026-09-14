import styles from "@/components/auth/Auth.module.css";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getServerSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  if (await getServerSession()) redirect(nextPath);

  return (
    <main className={styles.loginPage}>
      <header className={styles.topbar}>
        <span>Dalai Eej</span>
        <span className={styles.metadata}>Operations</span>
      </header>
      <div className={styles.loginWorkspace}>
        <aside className={styles.index} aria-hidden="true">01 / Нэвтрэх</aside>
        <section className={styles.loginPanel} aria-labelledby="login-title">
          <div className={styles.titleBand}>
            <h1 id="login-title">Нэвтрэх</h1>
            <p>Ажилтны хамгаалалттай нэвтрэх хэсэг</p>
          </div>
          <div className={styles.formBody}>
            <LoginForm nextPath={nextPath} />
          </div>
        </section>
      </div>
    </main>
  );
}

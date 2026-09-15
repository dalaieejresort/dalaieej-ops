import styles from "@/components/auth/Auth.module.css";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getServerSession, getWaiterLoginOptions } from "@/lib/server/auth";
import { WaiterLoginForm } from "@/components/auth/WaiterLoginForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; method?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const waiterLogin = params.method !== "password" && nextPath === "/waiter";
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
            <h1 id="login-title">{waiterLogin ? "Зөөгч нэвтрэх" : "Нэвтрэх"}</h1>
            <p>{waiterLogin ? "Нэрээ сонгоод ПИН кодоо оруулна уу" : "Ажилтны хамгаалалттай нэвтрэх хэсэг"}</p>
          </div>
          <div className={styles.formBody}>
            {waiterLogin ? <WaiterLoginForm waiters={getWaiterLoginOptions()} /> : <>
              <LoginForm nextPath={nextPath} />
              <Link className={styles.waiterLink} href="/login?next=%2Fwaiter">Зөөгчөөр нэвтрэх</Link>
            </>}
          </div>
        </section>
      </div>
    </main>
  );
}

import Image from "next/image";
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
    <main className="flex min-h-dvh items-center justify-center bg-[#f1f5f9] px-4 py-10 text-[#111827]">
      <section className="w-full max-w-md rounded-3xl border border-[#dbe3ec] bg-white p-7 shadow-xl sm:p-10">
        <div className="flex items-center gap-4">
          <Image src="/app-icon.svg" alt="" width={56} height={56} className="rounded-2xl border border-[#dbe3ec] bg-[#f8fafc] p-3" priority />
          <div>
            <h1 className="text-2xl font-black">Dalai Eej Ops</h1>
            <p className="mt-1 text-sm font-bold text-[#64748b]">Ажилтны хамгаалалттай нэвтрэх хэсэг</p>
          </div>
        </div>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import styles from "./ReconciliationInbox.module.css";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  detectReceiptContentType,
  RECEIPT_ACCEPT,
  RECEIPT_FILE_LIMIT_BYTES,
  safeReceiptFilename,
} from "@/lib/reconciliation/receipt-file";
import type {
  ReconciliationDashboard,
  ReconciliationEvent,
  ReconciliationMailProvider,
} from "@/lib/reconciliation/types";
import { ReconciliationInstallPrompt } from "@/components/reconciliation/ReconciliationInstallPrompt";

function localizedError(value: string) {
  if (/[А-Яа-яӨөҮү]/.test(value)) return value;
  if (/password|authentication|credentials|login/i.test(value)) return "Имэйлийн нэвтрэх мэдээллийг шалгана уу. Холбогдож чадсангүй.";
  if (/timeout|timed out|connect|network|fetch/i.test(value)) return "Сервертэй холбогдож чадсангүй. Дахин оролдоно уу.";
  if (/size|10 MB|too large/i.test(value)) return "Файлын хэмжээ 10 МБ-аас хэтэрч болохгүй.";
  if (/permission|forbidden|unauthorized/i.test(value)) return "Энэ үйлдлийг хийх эрх хүрэлцэхгүй байна.";
  return "Үйлдэл амжилтгүй боллоо. Тохиргоогоо шалгаад дахин оролдоно уу.";
}

function formatAmount(event: ReconciliationEvent) {
  if (event.amountMinor === null) return "Дүн тодорхойгүй";
  return new Intl.NumberFormat("mn-MN", {
    style: "currency",
    currency: event.currency,
    maximumFractionDigits: event.minorUnitDigits,
    minimumFractionDigits: event.minorUnitDigits,
  }).format(event.amountMinor / 10 ** event.minorUnitDigits);
}

function formatDate(value: string | null) {
  if (!value) return "Огноо тодорхойгүй";
  return new Intl.DateTimeFormat("mn-MN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ulaanbaatar",
  }).format(new Date(value));
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat("mn-MN", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatFileSize(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} КБ`
    : `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function statusLabel(event: ReconciliationEvent) {
  if (event.parseStatus !== "parsed") return "Шалгах шаардлагатай";
  if (event.reconciliationStatus === "matched") return "Тулгасан";
  if (event.reconciliationStatus === "candidate") return "Тохирох баримт санал болгосон";
  if (event.reconciliationStatus === "exception") return "Зөрүүтэй";
  if (event.reconciliationStatus === "no_receipt_required") {
    return "Баримт шаардлагагүй";
  }
  return "Баримт дутуу";
}

function statusClass(event: ReconciliationEvent) {
  if (event.reconciliationStatus === "matched") {
    return "border-emerald-200 bg-white text-emerald-800";
  }
  if (event.reconciliationStatus === "candidate") {
    return "border-amber-200 bg-white text-amber-900";
  }
  if (
    event.reconciliationStatus === "exception" ||
    event.parseStatus !== "parsed"
  ) {
    return "border-rose-200 bg-white text-rose-800";
  }
  return "border-amber-200 bg-white text-amber-900";
}

function SetupItem({ ready, label }: { ready: boolean; label: string }) {
  return (
    <li className="flex items-center gap-3 text-xs font-normal text-slate-700">
      <span
        aria-hidden="true"
        className={`grid size-6 place-items-center  text-xs font-normal ${
          ready
            ? "bg-white text-emerald-800"
            : "bg-slate-200 text-[#666666]"
        }`}
      >
        {ready ? "✓" : "–"}
      </span>
      {label}
    </li>
  );
}

type ImapProvider = Extract<
  ReconciliationMailProvider,
  "datacom" | "yahoo"
>;

function providerLabel(provider: ReconciliationMailProvider) {
  if (provider === "gmail") return "Gmail";
  if (provider === "yahoo") return "Yahoo";
  return "Datacom";
}

export function ReconciliationInbox({
  dashboard,
  initialDate,
  loadError,
}: {
  dashboard: ReconciliationDashboard;
  initialDate: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [connectingProvider, setConnectingProvider] =
    useState<ImapProvider | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] =
    useState<ReconciliationMailProvider | null>(null);
  const [syncDate, setSyncDate] = useState(initialDate);
  const [priorityMode, setPriorityMode] = useState<"transactions" | "receipts">(
    "transactions",
  );
  const [datacomEmail, setDatacomEmail] = useState("azzaya@dgb.mn");
  const [datacomPassword, setDatacomPassword] = useState("");
  const [yahooEmail, setYahooEmail] = useState("");
  const [yahooPassword, setYahooPassword] = useState("");
  const [uploadingEventId, setUploadingEventId] = useState<string | null>(null);
  const [uploadingSupportingDocuments, setUploadingSupportingDocuments] =
    useState(false);
  const [message, setMessage] = useState("");
  const readyForGmail =
    dashboard.setup.databaseConfigured &&
    dashboard.setup.gmailOAuthConfigured &&
    dashboard.setup.tokenEncryptionConfigured;
  const readyForImap =
    dashboard.setup.databaseConfigured &&
    dashboard.setup.tokenEncryptionConfigured;
  const connectedProviders = new Set(
    dashboard.connections.map((connection) => connection.provider),
  );
  const prioritizedEvents =
    priorityMode === "transactions"
      ? dashboard.events
      : [...dashboard.events].sort((left, right) => {
          const leftNeedsReceipt =
            !left.receiptId &&
            left.reconciliationStatus !== "no_receipt_required";
          const rightNeedsReceipt =
            !right.receiptId &&
            right.reconciliationStatus !== "no_receipt_required";
          return Number(rightNeedsReceipt) - Number(leftNeedsReceipt);
        });

  async function connectImap(
    provider: ImapProvider,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (connectingProvider) return;
    setConnectingProvider(provider);
    setMessage("");
    const emailAddress = provider === "yahoo" ? yahooEmail : datacomEmail;
    const password = provider === "yahoo" ? yahooPassword : datacomPassword;
    try {
      const response = await fetch(`/api/reconciliation/${provider}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAddress,
          password,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { emailAddress?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          (payload?.error ? localizedError(payload.error) : "") || `${providerLabel(provider)} холбогдож чадсангүй`,
        );
      }
      if (provider === "yahoo") setYahooPassword("");
      else setDatacomPassword("");
      setMessage(`${payload?.emailAddress || emailAddress} холбогдлоо.`);
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? localizedError(error.message)
          : `${providerLabel(provider)} холбогдож чадсангүй`,
      );
    } finally {
      setConnectingProvider(null);
    }
  }

  async function disconnectMailbox(provider: ReconciliationMailProvider) {
    if (disconnectingProvider) return;
    setDisconnectingProvider(provider);
    setMessage("");
    try {
      const response = await fetch(
        `/api/reconciliation/${provider}/disconnect`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error((payload?.error ? localizedError(payload.error) : "") || "Холболтыг салгаж чадсангүй");
      }
      setMessage("Имэйлийн холболтыг салгалаа. Татсан тулгалтын бүртгэлүүд хадгалагдана.");
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage(error instanceof Error ? localizedError(error.message) : "Холболтыг салгаж чадсангүй");
    } finally {
      setDisconnectingProvider(null);
    }
  }

  async function syncNow(limit?: number, date?: string) {
    if (syncing) return;
    setSyncing(true);
    setMessage("");
    try {
      const connections = date
        ? dashboard.connections.filter(
            (connection) => connection.provider !== "gmail",
          )
        : dashboard.connections;
      if (!connections.length) {
        throw new Error(
          date
            ? "Тодорхой өдрийн мэдээлэл татахын тулд Datacom эсвэл Yahoo хаяг холбоно уу"
            : "Эхлээд имэйл хаяг холбоно уу",
        );
      }

      const totals = {
        found: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        archived: 0,
      };
      const errors: string[] = [];
      for (const connection of connections) {
        const params = new URLSearchParams();
        if (limit) params.set("limit", String(limit));
        if (date) params.set("date", date);
        const response = await fetch(
          `/api/reconciliation/${connection.provider}/sync${params.size ? `?${params}` : ""}`,
          { method: "POST" },
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              found?: number;
              imported?: number;
              skipped?: number;
              failed?: number;
              archived?: number;
              error?: string;
            }
          | null;
        if (!response.ok) {
          errors.push(
            `${providerLabel(connection.provider)}: ${(payload?.error ? localizedError(payload.error) : "") || "мэдээлэл татаж чадсангүй"}`,
          );
          continue;
        }
        totals.found += payload?.found || 0;
        totals.imported += payload?.imported || 0;
        totals.skipped += payload?.skipped || 0;
        totals.failed += payload?.failed || 0;
        totals.archived += payload?.archived || 0;
      }

      if (errors.length === connections.length) throw new Error(errors.join("; "));
      const errorSuffix = errors.length ? ` ${errors.join("; ")}.` : "";
      if (totals.imported) {
        setMessage(`${totals.imported} шинэ банкны мэдэгдэл татлаа.${totals.archived ? ` ${totals.archived} захидлыг Transactions хавтас руу зөөлөө.` : ""}${errorSuffix}`);
      } else if (totals.archived) {
        setMessage(`${totals.archived} боловсруулсан мэдэгдлийг Transactions хавтас руу зөөлөө.${errorSuffix}`);
      } else if (totals.failed) {
        setMessage(`${totals.failed} банкны мэдэгдлийг таньж чадсангүй.${errorSuffix}`);
      } else if (!totals.found) {
        setMessage(`${date ? formatDay(date) + " өдөрт" : "Шинээр"} дэмжигдсэн банкны мэдэгдэл олдсонгүй.${errorSuffix}`);
      } else {
        setMessage(`${totals.found} мэдэгдэл өмнө нь татагдсан эсвэл дэмжигдээгүй гүйлгээ байна.${errorSuffix}`);
      }
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage(error instanceof Error ? localizedError(error.message) : "Мэдээлэл татаж чадсангүй");
    } finally {
      setSyncing(false);
    }
  }

  async function waitForReceipt(eventId: string) {
    for (const delay of [250, 500, 1000, 1600, 2400]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const response = await fetch(
        `/api/reconciliation/receipts?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as { receiptId?: string | null };
      if (payload.receiptId) return payload.receiptId;
    }
    return null;
  }

  async function uploadReceipt(eventId: string, file: File) {
    if (uploadingEventId) return;
    setUploadingEventId(eventId);
    setMessage("");
    try {
      if (!file.size || file.size > RECEIPT_FILE_LIMIT_BYTES) {
        throw new Error("Баримтын файл 1 байтаас 10 МБ хэмжээтэй байна.");
      }
      const firstBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      const contentType = detectReceiptContentType(firstBytes);
      if (!contentType) {
        throw new Error("PDF, JPEG, PNG, WebP, HEIC эсвэл HEIF баримт сонгоно уу.");
      }
      const receiptKey = crypto.randomUUID();
      const originalFilename = safeReceiptFilename(file.name, contentType);
      const pathname = `reconciliation-receipts/${eventId}/${receiptKey}/${originalFilename}`;
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/reconciliation/receipts/upload",
        contentType,
        clientPayload: JSON.stringify({
          eventId,
          receiptKey,
          originalFilename,
          contentType,
          fileSizeBytes: file.size,
        }),
      });
      const receiptId = await waitForReceipt(eventId);
      setMessage(
        receiptId
          ? "Баримтыг оруулж, гүйлгээтэй тулгалаа."
          : "Баримтыг орууллаа. Бүртгэлийг баталгаажуулж байна.",
      );
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage(error instanceof Error ? localizedError(error.message) : "Баримт оруулж чадсангүй");
    } finally {
      setUploadingEventId(null);
    }
  }

  async function waitForSupportingDocument(documentKey: string) {
    for (const delay of [250, 500, 1000, 1600, 2400]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      const response = await fetch(
        `/api/reconciliation/supporting-documents?key=${encodeURIComponent(documentKey)}`,
        { cache: "no-store" },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        documentId?: string | null;
      };
      if (payload.documentId) return payload.documentId;
    }
    return null;
  }

  async function uploadSupportingDocuments(files: File[]) {
    if (uploadingSupportingDocuments || files.length === 0) return;
    setUploadingSupportingDocuments(true);
    setMessage("");
    let completed = 0;
    try {
      for (const file of files) {
        if (!file.size || file.size > RECEIPT_FILE_LIMIT_BYTES) {
          throw new Error(`${file.name} файлын хэмжээ 1 байтаас 10 МБ байна.`);
        }
        const firstBytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
        const contentType = detectReceiptContentType(firstBytes);
        if (!contentType) {
          throw new Error(
            `${file.name} нь PDF, JPEG, PNG, WebP, HEIC эсвэл HEIF файл биш байна.`,
          );
        }
        const documentKey = crypto.randomUUID();
        const originalFilename = safeReceiptFilename(file.name, contentType);
        const pathname = `reconciliation-supporting-documents/${syncDate}/${documentKey}/${originalFilename}`;
        await upload(pathname, file, {
          access: "private",
          handleUploadUrl: "/api/reconciliation/supporting-documents/upload",
          contentType,
          clientPayload: JSON.stringify({
            documentKey,
            reconciliationDate: syncDate,
            originalFilename,
            contentType,
            fileSizeBytes: file.size,
          }),
        });
        const documentId = await waitForSupportingDocument(documentKey);
        if (!documentId) {
          throw new Error(`${file.name} файлыг оруулсан боловч бүртгэлийг баталгаажуулж чадсангүй.`);
        }
        completed += 1;
        setMessage(
          `${formatDay(syncDate)} өдрийн баримтыг оруулж байна: ${files.length}-с ${completed}`,
        );
      }
      setMessage(
        `${formatDay(syncDate)} өдөрт ${completed} нотлох баримт орууллаа. Гүйлгээний тулгалтын төлөв өөрчлөгдөөгүй.`,
      );
      startRefresh(() => router.refresh());
    } catch (error) {
      const detail =
        error instanceof Error ? localizedError(error.message) : "Нотлох баримт оруулж чадсангүй";
      setMessage(
        completed
          ? `${files.length} баримтаас ${completed}-г орууллаа. ${detail}`
          : detail,
      );
      startRefresh(() => router.refresh());
    } finally {
      setUploadingSupportingDocuments(false);
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>Dalai Eej <span>/ Үйл ажиллагаа</span></Link>
        <span className={styles.topbarLabel}>Санхүүгийн хэсэг</span>
        <ReconciliationInstallPrompt />
      </header>
      <nav className={styles.rail} aria-label="Үндсэн цэс">
        <Link href="/register?tab=sale"><span>01</span> Борлуулалт</Link>
        <Link href="/register?tab=charges"><span>02</span> Өр</Link>
        <Link href="/register?tab=history"><span>03</span> Түүх</Link>
        <Link href="/register?tab=day-close"><span>04</span> Өдрийн хаалт</Link>
        <Link href="/reconciliation" aria-current="page"><span>05</span> Тулгалт</Link>
      </nav>
      <div className={styles.page}>
        <div className={styles.titleBand}>
          <h1>Тулгалт</h1>
          <p>{formatDay(syncDate)} <span> / Улаанбаатар</span></p>
        </div>
        <div className={styles.columns}>
        <section className={styles.workingColumn}>
          <div className={styles.metrics}>
            {[
              ["Гүйлгээ", dashboard.summary.total],
              ["Баримт дутуу", dashboard.summary.awaitingReceipt],
              ["Санал болгосон", dashboard.summary.candidates],
              ["Тулгасан", dashboard.summary.matched],
            ].map(([label, value], index) => (
              <article key={String(label)}>
                <p><span>{String(index + 1).padStart(2, "0")}</span>{label}</p>
                <p className={styles.metricValue}>{value}</p>
              </article>
            ))}
          </div>

          <section id="supporting-documents" className="order-3 border border-[#8c8c8c] bg-white p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-normal uppercase tracking-[0.18em] text-[#666666]">
                  02 / Нотлох баримт
                </p>
                <h2 className="mt-1 text-sm font-normal">
                  Нотлох баримтууд · {formatDay(syncDate)}
                </h2>
                <p className="mt-1 text-xs font-normal text-[#666666]">
                  Банкны хуулга, кассын дэвтэр, өдрийн тайлан. Эдгээр файлыг оруулахад гүйлгээний тулгалтын төлөв өөрчлөгдөхгүй.
                </p>
              </div>
              {dashboard.setup.receiptStorageConfigured ? (
                <label className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center border border-[#8c8c8c] bg-white px-5 text-xs font-normal text-black transition hover:bg-[#f5f5f5] has-[:disabled]:cursor-wait has-[:disabled]:bg-slate-400">
                  <input
                    type="file"
                    multiple
                    accept={RECEIPT_ACCEPT}
                    className="sr-only"
                    disabled={uploadingSupportingDocuments}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      event.currentTarget.value = "";
                      if (files.length) void uploadSupportingDocuments(files);
                    }}
                  />
                  {uploadingSupportingDocuments
                    ? "Баримтуудыг оруулж байна…"
                    : "Нотлох баримт оруулах"}
                </label>
              ) : null}
            </div>
            {dashboard.supportingDocuments.length ? (
              <>
              <details className="mt-5 sm:hidden">
                <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between border border-[#8c8c8c] bg-white px-4 text-xs font-normal text-[#000000]">
                  {dashboard.supportingDocuments.length} баримт харах
                  <span aria-hidden="true">⌄</span>
                </summary>
                <ul className="mt-2 grid gap-2">
                  {dashboard.supportingDocuments.map((document) => (
                    <li key={document.id}>
                      <a
                        href={`/api/reconciliation/supporting-documents?id=${encodeURIComponent(document.id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 border border-[#8c8c8c] bg-white px-4 py-3 text-xs font-normal text-[#000000]"
                        title={document.originalFilename}
                      >
                        <span className="truncate">{document.originalFilename}</span>
                        <span className="shrink-0 text-xs text-[#666666]">
                          {formatFileSize(document.fileSizeBytes)}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
              <ul className="mt-5 hidden gap-2 sm:grid sm:grid-cols-2">
                {dashboard.supportingDocuments.map((document) => (
                  <li key={document.id}>
                    <a
                      href={`/api/reconciliation/supporting-documents?id=${encodeURIComponent(document.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 border border-[#8c8c8c] bg-white px-4 py-3 text-xs font-normal text-[#000000] hover:bg-[#f5f5f5]"
                      title={document.originalFilename}
                    >
                      <span className="truncate">{document.originalFilename}</span>
                      <span className="shrink-0 text-xs text-[#666666]">
                        {formatFileSize(document.fileSizeBytes)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              </>
            ) : (
              <p className="mt-5 border border-dashed border-[#8c8c8c] px-4 py-5 text-center text-xs font-normal text-[#666666]">
                Энэ өдөрт нотлох баримт оруулаагүй байна.
              </p>
            )}
          </section>

          <section id="transactions" className="order-2 overflow-hidden border border-[#8c8c8c] bg-white">
            <div className="flex flex-col gap-4 border-b border-[#8c8c8c] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="text-sm font-normal">Гүйлгээ</h2>
                <p className="mt-1 text-xs font-normal text-[#666666]">
                  {priorityMode === "transactions"
                    ? "Сүүлийн гүйлгээг эхэнд харуулна."
                    : "Баримт дутуу гүйлгээг эхэнд харуулна."}
                </p>
                <fieldset className="mt-3">
                  <legend className="sr-only">Эрэмбэлэх дараалал</legend>
                  <div className="inline-flex border border-[#8c8c8c] bg-white p-1">
                    <button
                      type="button"
                      aria-pressed={priorityMode === "transactions"}
                      onClick={() => setPriorityMode("transactions")}
                      className={` px-3 py-1.5 text-xs font-normal transition ${
                        priorityMode === "transactions"
                          ? "bg-[#000000] text-white "
                          : "text-[#666666] hover:bg-white"
                      }`}
                    >
                      Гүйлгээгээр
                    </button>
                    <button
                      type="button"
                      aria-pressed={priorityMode === "receipts"}
                      onClick={() => setPriorityMode("receipts")}
                      className={` px-3 py-1.5 text-xs font-normal transition ${
                        priorityMode === "receipts"
                          ? "bg-[#000000] text-white "
                          : "text-[#666666] hover:bg-white"
                      }`}
                    >
                      Баримт дутуугаас
                    </button>
                  </div>
                </fieldset>
              </div>
              {dashboard.connections.length ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="text-xs font-normal text-[#666666]">
                    Тулгах огноо
                    <input
                      type="date"
                      value={syncDate}
                      onChange={(event) => {
                        const nextDate = event.target.value;
                        setSyncDate(nextDate);
                        if (nextDate) {
                          router.replace(`/reconciliation?date=${encodeURIComponent(nextDate)}`);
                        }
                      }}
                      className="mt-1 block h-9 border border-[#8c8c8c] bg-white px-3 text-xs font-normal focus:border-[#8c8c8c]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => syncNow(undefined, syncDate)}
                    disabled={syncing || isRefreshing || !syncDate}
                    className="h-9 bg-[#D2042D] px-5 text-xs font-normal text-white transition hover:bg-[#B80327] disabled:cursor-wait disabled:bg-slate-400"
                  >
                    {syncing || isRefreshing
                      ? "Имэйл шалгаж байна…"
                      : `Татах: ${new Intl.DateTimeFormat("mn-MN", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${syncDate}T00:00:00Z`))}`}
                  </button>
                </div>
              ) : null}
            </div>

            {message ? (
              <p className="border-b border-[#8c8c8c] bg-white px-6 py-3 text-xs font-normal text-[#000000]" role="status">
                {message}
              </p>
            ) : null}

            {dashboard.events.length === 0 ? (
              <div className="grid min-h-72 place-items-center px-6 py-14 text-center">
                <div className="max-w-md">
                  <div className="mx-auto grid size-14 place-items-center bg-white text-2xl" aria-hidden="true">
                    ↔
                  </div>
                  <h3 className="mt-5 text-sm font-normal">Гүйлгээ татаагүй байна</h3>
                  <p className="mt-2 text-xs font-normal leading-6 text-[#666666]">
                    ХХБ болон Хаан банкны гүйлгээг татахын тулд имэйл хаяг холбоод, шалгах баримтуудаа хавсаргана уу.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[#ece8df]">
                {prioritizedEvents.map((event) => (
                  <article
                    key={event.id}
                    className={styles.transaction}
                  >
                    <div>
                      <p className="text-xs font-normal text-slate-800">
                        {formatDate(event.transactionAt ?? event.receivedAt)}
                      </p>
                      <p className="mt-1 text-xs font-normal text-[#666666]">
                        {event.accountLabel}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words font-normal text-slate-900">
                        {event.counterparty || "Харилцагч тодорхойгүй"}
                      </p>
                      <p className="mt-1 break-words text-xs font-normal text-[#666666]">
                        {event.description || event.destinationBank || "Гүйлгээний утга байхгүй"}
                      </p>
                      <span
                        className={`mt-3 inline-flex  border px-2.5 py-1 text-xs font-normal ${statusClass(event)}`}
                      >
                        {statusLabel(event)}
                      </span>
                    </div>
                    <div className="sm:text-right">
                      <p className="font-normal tabular-nums text-slate-900">
                        −{formatAmount(event)}
                      </p>
                      <p className="mt-1 text-xs font-normal text-[#666666]">
                        {event.authenticityStatus === "verified"
                          ? "Илгээгч баталгаажсан"
                          : "Илгээгчийг шалгах"}
                      </p>
                      {event.receiptId ? (
                        <a
                          href={`/api/reconciliation/receipts?id=${encodeURIComponent(event.receiptId)}`}
                          target="_blank"
                          rel="noreferrer"
                          title={event.receiptFilename || "Баримт харах"}
                          className="mt-3 inline-flex h-9 items-center justify-center border border-emerald-200 bg-white px-3 text-xs font-normal text-emerald-800 hover:bg-white"
                        >
                          Баримт харах
                        </a>
                      ) : dashboard.setup.receiptStorageConfigured ? (
                        <label className="mt-3 inline-flex h-9 cursor-pointer items-center justify-center border border-[#8c8c8c] bg-white px-3 text-xs font-normal text-[#000000] hover:bg-[#f5f5f5] has-[:disabled]:cursor-wait has-[:disabled]:opacity-60">
                          <input
                            type="file"
                            accept={RECEIPT_ACCEPT}
                            className="sr-only"
                            disabled={Boolean(uploadingEventId)}
                            onChange={(changeEvent) => {
                              const file = changeEvent.currentTarget.files?.[0];
                              changeEvent.currentTarget.value = "";
                              if (file) void uploadReceipt(event.id, file);
                            }}
                          />
                          {uploadingEventId === event.id
                            ? "Оруулж байна…"
                            : "Баримт оруулах"}
                        </label>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <aside id="connections" className={styles.inspector}>
          <section className="border border-[#8c8c8c] bg-white p-6">
            <p className="text-xs font-normal uppercase tracking-[0.18em] text-[#666666]">
              03 / Холболтууд
            </p>
            <p className="mt-2 text-xs font-normal leading-6 text-[#666666]">
              Банкны мэдэгдэл хүлээн авдаг имэйл хаяг бүрийг холбоно уу. Холболт тус бүр бие даасан байна.
            </p>

            {dashboard.connections.length ? (
              <div className="mt-5 space-y-3">
                {dashboard.connections.map((connection) => (
                  <div
                    key={connection.provider}
                    className="border border-[#8c8c8c] bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-normal uppercase tracking-[0.12em] text-[#666666]">
                          {providerLabel(connection.provider)}
                        </p>
                        <h2 className="mt-1 break-all text-xs font-normal text-slate-900">
                          {connection.emailAddress}
                        </h2>
                      </div>
                      <span className="bg-white px-2 py-1 text-[10px] font-normal text-emerald-800">
                        Холбогдсон
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-normal leading-5 text-[#666666]">
                      {connection.provider === "gmail"
                        ? "Зөвхөн уншина. Gmail захидлыг зөөх, архивлах, өөрчлөхгүй."
                        : connection.provider === "yahoo"
                          ? "Зөвшөөрөгдсөн Хаан банкны дансны мэдэгдлүүдийг боловсруулж, Yahoo дахь Transactions хавтас руу зөөнө."
                          : "ХХБ болон Хаан банкны мэдэгдлүүдийг боловсруулж, Datacom дахь Transactions хавтас руу зөөнө."}
                    </p>
                    <p className="mt-2 text-[11px] font-normal text-[#666666]">
                      Сүүлд шалгасан: {connection.lastSyncAt ? formatDate(connection.lastSyncAt) : "Шалгаагүй"}
                    </p>
                    <button
                      type="button"
                      onClick={() => void disconnectMailbox(connection.provider)}
                      disabled={Boolean(disconnectingProvider)}
                      className="mt-3 text-xs font-normal text-rose-700 underline decoration-rose-200 underline-offset-4 disabled:cursor-wait disabled:text-[#666666]"
                    >
                      {disconnectingProvider === connection.provider
                        ? "Салгаж байна…"
                        : `${providerLabel(connection.provider)} холболтыг салгах`}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 bg-white px-3 py-2 text-xs font-normal text-amber-900">
                Имэйл хаяг холбоогүй байна.
              </p>
            )}

            {readyForImap && !connectedProviders.has("yahoo") ? (
              <form
                className="mt-6 space-y-3 border-t border-[#8c8c8c] pt-5"
                onSubmit={(event) => void connectImap("yahoo", event)}
              >
                <h2 className="font-normal">Хаан банкны мэдэгдэлд Yahoo холбох</h2>
                <label className="block text-xs font-normal text-slate-700">
                  Yahoo имэйл
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    placeholder="yourname@yahoo.com"
                    value={yahooEmail}
                    onChange={(event) => setYahooEmail(event.target.value)}
                    className="mt-1.5 h-9 w-full border border-[#8c8c8c] bg-white px-3 text-xs font-normal focus:border-[#8c8c8c]"
                  />
                </label>
                <label className="block text-xs font-normal text-slate-700">
                  Yahoo аппын нууц үг
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={yahooPassword}
                    onChange={(event) => setYahooPassword(event.target.value)}
                    className="mt-1.5 h-9 w-full border border-[#8c8c8c] bg-white px-3 text-xs font-normal focus:border-[#8c8c8c]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={Boolean(connectingProvider)}
                  className="flex h-9 w-full items-center justify-center bg-black px-4 text-xs font-normal text-white hover:bg-[#262626] disabled:cursor-wait disabled:bg-slate-400"
                >
                  {connectingProvider === "yahoo"
                    ? "Баталгаажуулж байна…"
                    : "Yahoo имэйл холбох"}
                </button>
                <p className="text-xs font-normal leading-5 text-[#666666]">
                  Yahoo-оос үүсгэсэн аппын нууц үгийг ашиглана уу. Нууц үгийг шифрлэж хадгална. Чатаар бүү илгээнэ үү. Зөвхөн зөвшөөрөгдсөн Хаан банкны дансны мэдэгдлийг татаж, боловсруулсан захидлыг Yahoo дахь Transactions хавтас руу зөөнө.
                </p>
                <a
                  href="https://login.yahoo.com/account/security"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs font-normal text-[#000000] underline decoration-[#b7c9c2] underline-offset-4"
                >
                  Аппын нууц үг үүсгэхээр Yahoo-ийн аюулгүй байдлын тохиргоог нээх
                </a>
              </form>
            ) : null}

            {readyForImap && !connectedProviders.has("datacom") ? (
              <details className="mt-5 border-t border-[#8c8c8c] pt-4">
                <summary className="cursor-pointer text-xs font-normal text-[#000000]">
                  Datacom имэйл холбох
                </summary>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => void connectImap("datacom", event)}
                >
                  <label className="block text-xs font-normal text-slate-700">
                    Datacom имэйл
                    <input
                      type="email"
                      autoComplete="username"
                      required
                      value={datacomEmail}
                      onChange={(event) => setDatacomEmail(event.target.value)}
                      className="mt-1.5 h-9 w-full border border-[#8c8c8c] bg-white px-3 text-xs font-normal focus:border-[#8c8c8c]"
                    />
                  </label>
                  <label className="block text-xs font-normal text-slate-700">
                    Имэйлийн нууц үг
                    <input
                      type="password"
                      autoComplete="current-password"
                      required
                      value={datacomPassword}
                      onChange={(event) => setDatacomPassword(event.target.value)}
                      className="mt-1.5 h-9 w-full border border-[#8c8c8c] bg-white px-3 text-xs font-normal focus:border-[#8c8c8c]"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={Boolean(connectingProvider)}
                    className="flex h-9 w-full items-center justify-center bg-black px-4 text-xs font-normal text-white hover:bg-[#262626] disabled:cursor-wait disabled:bg-slate-400"
                  >
                    {connectingProvider === "datacom"
                      ? "Баталгаажуулж байна…"
                      : "Datacom имэйл холбох"}
                  </button>
                </form>
              </details>
            ) : null}

            {readyForGmail && !connectedProviders.has("gmail") ? (
              <a
                href="/api/reconciliation/gmail/connect"
                className="mt-5 block border-t border-[#8c8c8c] pt-4 text-center text-xs font-normal text-[#000000] underline decoration-[#b7c9c2] underline-offset-4"
              >
                Gmail хаяг холбох (зөвхөн унших)
              </a>
            ) : null}
          </section>

          {!readyForImap || !dashboard.setup.receiptStorageConfigured || loadError ? (
            <section className="border border-[#8c8c8c] bg-white p-6">
              <h2 className="font-normal">Хувийн тохиргоо</h2>
              <p className="mt-2 text-xs font-normal leading-6 text-[#666666]">
                Энэ хэсгийн мэдээлэл үйл ажиллагаа болон нягтлан бодох бүртгэлээс тусдаа хадгалагдана.
              </p>
              <ul className="mt-5 space-y-3">
                <SetupItem ready={dashboard.setup.databaseConfigured && !loadError} label="Тусдаа PostgreSQL мэдээллийн сан" />
                <SetupItem ready={dashboard.setup.tokenEncryptionConfigured} label="Имэйлийн нэвтрэх мэдээллийг шифрлэж хадгалах" />
                <SetupItem ready label="Datacom болон Yahoo-ийн SSL/IMAP холболт бэлэн" />
                <SetupItem ready={dashboard.setup.receiptStorageConfigured} label="Баримтын хувийн хадгалалт" />
              </ul>
              {loadError ? (
                <p className="mt-4 bg-white px-3 py-2 text-xs font-normal text-rose-800" role="alert">
                  {loadError}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="bg-white p-6 text-[#000000]">
            <h2 className="font-normal">Энэ хэсгийн боломжууд</h2>
            <ul className="mt-4 space-y-3 text-xs font-normal leading-5">
              <li>• ХХБ болон Хаан банкны гүйлгээний мэдэгдлийг уншина</li>
              <li>• Баримт дутуу гүйлгээг бүртгэнэ</li>
              <li>• Хүнээр батлуулах тулгалтыг санал болгоно</li>
              <li>• Шалгалтын түүхийг тусад нь хадгална</li>
            </ul>
          </section>
        </aside>
        </div>
      </div>
    </main>
  );
}

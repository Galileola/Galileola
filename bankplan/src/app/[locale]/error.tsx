"use client"; // Error pages must run in the browser.

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Shown when a page fails unexpectedly (for example, the database is not reachable). */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("errorPage");
  // In production the message is generic; the code matches the server log without exposing details.
  const code = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      <p className="text-slate-700">{t("text")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => retry()} className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800">
          {t("retry")}
        </button>
        <Link href="/plans" className="text-blue-700 underline">
          {t("home")}
        </Link>
      </div>
      {code && <p className="text-xs text-slate-500">{t("code", { code })}</p>}
    </div>
  );
}

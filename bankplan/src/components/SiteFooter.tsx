import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Shown on every page: the "not advice" disclaimer and the privacy link. */
export async function SiteFooter() {
  const t = await getTranslations("footer");

  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p role="note">{t("disclaimer")}</p>
        <Link href="/privacy" className="shrink-0 underline hover:text-slate-900">
          {t("privacy")}
        </Link>
      </div>
    </footer>
  );
}

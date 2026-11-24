import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LanguageSwitcher } from "./LanguageSwitcher";

export async function SiteHeader() {
  const t = await getTranslations();
  const user = await getCurrentUser();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-semibold text-slate-900">
          {t("app.name")}
        </Link>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/plans" className="text-slate-700 hover:text-slate-900">
                {t("nav.plans")}
              </Link>
              <Link href="/settings" className="text-slate-700 hover:text-slate-900">
                {t("nav.settings")}
              </Link>
            </>
          ) : (
            <Link href="/login" className="text-slate-700 hover:text-slate-900">
              {t("nav.login")}
            </Link>
          )}
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** ET | RU | EN links that keep the user on the same page. */
export function LanguageSwitcher() {
  const t = useTranslations("nav");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className="flex gap-1 text-sm">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === current ? "true" : undefined}
          className={
            locale === current
              ? "rounded px-2 py-1 font-semibold text-slate-900 bg-slate-200"
              : "rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          }
        >
          {locale.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

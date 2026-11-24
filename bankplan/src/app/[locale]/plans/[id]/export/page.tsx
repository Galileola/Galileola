import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { isAiConfigured } from "@/lib/ai/claude";
import { requireUser } from "@/lib/auth";
import { filledFinanceInputs, sectionsNeedingTranslation } from "@/lib/export/buildDocument";
import { readPlanAnswers } from "@/lib/plan/answers";
import { getMyPlanFull } from "@/lib/plans";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";
import { TranslateButton } from "./TranslateButton";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ lang?: string }>;
};

export default async function ExportPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  await requireUser(locale);
  const plan = await getMyPlanFull(id);
  if (!plan) notFound();

  const requested = (await searchParams).lang;
  // The document language; by default the language of the app.
  const lang: Locale = hasLocale(routing.locales, requested) ? requested : (locale as Locale);
  const answers = readPlanAnswers(plan.answers);
  const missing = bankLoanSections.filter((section) => !answers[section]?.text.trim());
  const toTranslate = sectionsNeedingTranslation(answers, lang);
  const hasNumbers = filledFinanceInputs(plan.finance) !== null;
  const download = (format: "docx" | "pdf") => `/api/plans/${plan.id}/export?format=${format}&lang=${lang}`;

  const t = await getTranslations();

  return (
    <div className="space-y-6">
      <Link href={`/plans/${plan.id}`} className="text-sm text-blue-700 underline">
        {t("plan.toOverview")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("export.title")}</h1>
        <p className="mt-1 text-slate-600">{t("export.intro")}</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold text-slate-900">{t("export.language")}</h2>
        <div className="flex flex-wrap gap-2">
          {routing.locales.map((option) => (
            <Link
              key={option}
              href={`/plans/${plan.id}/export?lang=${option}`}
              aria-current={option === lang ? "true" : undefined}
              className={
                option === lang
                  ? "rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-white"
                  : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:border-blue-400"
              }
            >
              {t(`export.languages.${option}`)}
            </Link>
          ))}
        </div>
      </section>

      {toTranslate.length > 0 && (
        <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4">
          <h2 className="font-semibold text-violet-950">{t("export.translateTitle")}</h2>
          <p className="text-violet-950">
            {t("export.translateNeeded", { count: toTranslate.length, language: t(`export.languages.${lang}`) })}
          </p>
          <ul className="list-disc pl-5 text-sm text-violet-950">
            {toTranslate.map((section) => (
              <li key={section}>{t(`sections.${section}.title`)}</li>
            ))}
          </ul>
          <TranslateButton planId={plan.id} lang={lang} aiConfigured={isAiConfigured()} />
          <p className="text-sm text-violet-900">{t("export.withoutTranslation")}</p>
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">{t("export.missingTitle")}</h2>
        {missing.length === 0 ? (
          <p className="text-slate-700">{t("export.missingNone")}</p>
        ) : (
          <ul className="list-disc pl-5 text-slate-700">
            {missing.map((section) => (
              <li key={section}>
                <Link href={`/plans/${plan.id}/step/${section}`} className="text-blue-700 underline">
                  {t(`sections.${section}.title`)}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!hasNumbers && (
          <p className="text-amber-800">
            {t("export.numbersMissing")}{" "}
            <Link href={`/plans/${plan.id}/finance`} className="text-blue-700 underline">
              {t("finance.title")}
            </Link>
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        {/* Plain links: the browser downloads the file. */}
        <a href={download("docx")} className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800">
          {t("export.word")}
        </a>
        <a href={download("pdf")} className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800">
          {t("export.pdf")}
        </a>
      </div>
      <p className="text-sm text-slate-600">{t("export.checkNote")}</p>
    </div>
  );
}

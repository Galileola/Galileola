import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { companyTypes, type CompanyType } from "@/config/countries/ee";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { isAiConfigured } from "@/lib/ai/claude";
import { requireUser } from "@/lib/auth";
import { readPlanAnswers } from "@/lib/plan/answers";
import { getMyPlanFull } from "@/lib/plans";
import { checkPlan, INTERVIEW_MAX, PLAN_CHECK_MAX, readinessScore, type PlanCheck } from "@/lib/review/readiness";
import { currentRating, MAX_INTERVIEW_ANSWER, planFingerprint, readReview } from "@/lib/review/review";
import { InterviewForm } from "./InterviewForm";
import { StartReviewButton } from "./StartReviewButton";

// The AI officer can take a minute or two; the actions on this page may run up to 5 minutes.
export const maxDuration = 300;

type Props = { params: Promise<{ locale: string; id: string }> };

const STATUS_STYLE = {
  ok: "bg-green-100 text-green-900",
  partial: "bg-amber-100 text-amber-900",
  fail: "bg-red-100 text-red-900",
  needsNumbers: "bg-slate-100 text-slate-700",
} as const;
const LEVEL_STYLE = {
  ready: "border-green-300 bg-green-50 text-green-900",
  almost: "border-amber-300 bg-amber-50 text-amber-900",
  notReady: "border-red-300 bg-red-50 text-red-900",
} as const;

export default async function ReviewPage({ params }: Props) {
  const { locale, id } = await params;
  await requireUser(locale);
  const plan = await getMyPlanFull(id);
  if (!plan) notFound();

  const t = await getTranslations();
  const format = await getFormatter();
  const companyType: CompanyType = (companyTypes as readonly string[]).includes(plan.company_type)
    ? (plan.company_type as CompanyType)
    : "OU";
  const answers = readPlanAnswers(plan.answers);
  const checks = checkPlan(answers, plan.finance, companyType);
  const review = readReview(plan.review);
  const questionRatings = review ? review.questions.map(currentRating) : [];
  const score = readinessScore(checks, questionRatings);
  const stale = review !== null && review.planHash !== planFingerprint(answers, plan.finance);

  const ratio = (v: number) => format.number(v, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const percent = (v: number) => format.number(v, { style: "percent", maximumFractionDigits: 0 });
  const eur = (v: number) => format.number(v, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const month = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return format.dateTime(new Date(Date.UTC(y, m - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
  };

  /** The explanation under each check, in the user's language. */
  function explain(c: PlanCheck): string {
    const v = c.values;
    const n = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
    if (c.status === "needsNumbers") return t("review.needsNumbersText");
    switch (c.id) {
      case "sections":
        return t("review.checks.sections.text", { done: n("done"), total: n("total") });
      case "numbers":
        return c.status === "ok" ? t("review.checks.numbers.ok") : t("review.checks.numbers.missing");
      case "dscr":
        return t("review.checks.dscr.text", { value: ratio(n("value")), minimum: ratio(n("minimum")) });
      case "cash":
        return typeof v.month === "string"
          ? t("review.checks.cash.fail", { month: month(v.month), lowest: eur(n("lowest")) })
          : t("review.checks.cash.ok", { lowest: eur(n("lowest")) });
      case "ownContribution":
        return t("review.checks.ownContribution.text", { share: percent(n("share")), good: percent(n("good")), minimum: percent(n("minimum")) });
      case "equity":
        return t("review.checks.equity.text", { value: percent(n("value")), minimum: percent(n("minimum")) });
      case "currentRatio":
        return v.value === null ? t("review.checks.currentRatio.none") : t("review.checks.currentRatio.text", { value: ratio(n("value")), minimum: ratio(n("minimum")) });
      case "debtToTurnover":
        return v.value === null ? t("review.checks.debtToTurnover.noSales") : t("review.checks.debtToTurnover.text", { value: ratio(n("value")), maximum: ratio(n("maximum")) });
    }
  }

  return (
    <div className="space-y-8">
      <Link href={`/plans/${plan.id}`} className="text-sm text-blue-700 underline">
        {t("plan.toOverview")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("review.title")}</h1>
        <p className="mt-1 text-slate-600">{t("review.intro")}</p>
      </div>

      {/* Score */}
      <section className={`rounded-lg border p-4 ${LEVEL_STYLE[score.level]}`} aria-labelledby="score-title">
        <h2 id="score-title" className="text-sm font-semibold uppercase tracking-wide">{t("review.scoreTitle")}</h2>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-4xl font-bold">{t("review.scoreOutOf", { score: score.total })}</span>
          <span className="text-lg font-semibold">{t(`review.levels.${score.level}`)}</span>
        </p>
        <div className="mt-3 h-3 w-full rounded-full bg-white/70" aria-hidden="true">
          <div className="h-3 rounded-full bg-current" style={{ width: `${score.total}%` }} />
        </div>
        <ul className="mt-3 space-y-0.5 text-sm">
          <li>{t("review.planPart", { points: score.plan, max: PLAN_CHECK_MAX })}</li>
          <li>{t("review.interviewPart", { points: score.interview, max: INTERVIEW_MAX })}</li>
        </ul>
        <p className="mt-2 text-sm">{t("review.scoreNote")}</p>
      </section>

      {/* Plan check */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("review.checksTitle")}</h2>
          <p className="text-sm text-slate-600">{t("review.checksIntro")}</p>
        </div>
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{t(`review.checks.${c.id}.title`)}</span>
                <span className="flex items-center gap-2 text-sm">
                  <span className={`rounded px-2 py-0.5 ${STATUS_STYLE[c.status]}`}>{t(`review.status.${c.status}`)}</span>
                  <span className="text-slate-600">{t("review.points", { points: c.points, max: c.max })}</span>
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{explain(c)}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                {c.firstMissing && (
                  <Link href={`/plans/${plan.id}/step/${c.firstMissing}`} className="text-blue-700 underline">
                    {t("review.fixSection", { section: t(`sections.${c.firstMissing}.title`) })}
                  </Link>
                )}
                {c.id !== "sections" && c.status !== "ok" && (
                  <Link href={`/plans/${plan.id}/finance`} className="text-blue-700 underline">
                    {t("review.fixNumbers")}
                  </Link>
                )}
                {c.sourceUrl && (
                  <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-slate-500 underline">
                    {t("review.source")}: {new URL(c.sourceUrl).hostname.replace(/^www\./, "")}
                  </a>
                )}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* AI officer */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t("review.officerTitle")}</h2>
          <p className="text-sm text-slate-600">{t("review.officerIntro")}</p>
        </div>

        {review ? (
          <>
            <p className="text-sm text-slate-600">
              {t("review.madeOn", { date: format.dateTime(new Date(review.createdAt), { dateStyle: "long", timeZone: "Europe/Tallinn" }) })}
            </p>
            {stale && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{t("review.stale")}</p>}
            {review.locale !== locale && (
              <p className="rounded-md border border-slate-300 bg-slate-50 p-3 text-slate-800">
                {t("review.otherLanguage", { language: t(`document.languages.${review.locale}`) })}
              </p>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-semibold text-slate-900">{t("review.summaryTitle")}</h3>
              <p className="mt-1 whitespace-pre-line text-slate-800">{review.summary}</p>
            </div>

            {review.weakPoints.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-900">{t("review.weakTitle")}</h3>
                <ol className="mt-2 list-decimal space-y-3 pl-5">
                  {review.weakPoints.map((w, i) => (
                    <li key={i} className="text-slate-800">
                      <span className="font-medium">{w.title}</span>
                      <p className="text-sm">{w.explanation}</p>
                      <p className="text-sm text-blue-900">
                        <span className="font-medium">{t("review.howToFix")}:</span> {w.fix}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <InterviewForm
              planId={plan.id}
              reviewCreatedAt={review.createdAt}
              aiConfigured={isAiConfigured()}
              maxAnswerLength={MAX_INTERVIEW_ANSWER}
              questions={review.questions.map((q, i) => ({
                question: q.question,
                why: q.why,
                answer: q.answer,
                rating: questionRatings[i] && q.rating ? { value: questionRatings[i], feedback: q.rating.feedback } : null,
              }))}
            />
            <p className="text-sm text-slate-600">{t("review.practiceNote")}</p>
          </>
        ) : null}

        <StartReviewButton planId={plan.id} locale={locale as Locale} hasReview={review !== null} aiConfigured={isAiConfigured()} />
      </section>
    </div>
  );
}

"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Source } from "@/config/types";
import type { ExplainTopic, ExplainValue, TopicId } from "@/lib/finance/explain";

/** The element id of a topic's box, used by the "How?" links next to the results. */
export const explainAnchor = (id: TopicId) => `explain-${id}`;

/** Opens a topic's box and scrolls to it. */
export function openExplanation(id: TopicId) {
  const box = document.getElementById(explainAnchor(id));
  if (box instanceof HTMLDetailsElement) {
    box.open = true;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/** Small "How?" button next to a number in the results tables. */
export function HowLink({ topic }: { topic: TopicId }) {
  const t = useTranslations("finance.explain");
  return (
    <button
      type="button"
      onClick={() => openExplanation(topic)}
      className="ml-1 text-xs text-blue-700 underline print:hidden"
    >
      {t("how")}
      <span className="sr-only"> {t(`topics.${topic}`)}</span>
    </button>
  );
}

/**
 * Short name of a source: the section of the act ("SMS § 7 lg 1") without the English notes
 * kept in the config file, or the website's name.
 */
function sourceLabel(url: string, ref?: string) {
  if (ref) return ref.split(/ \(| — /)[0];
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One link per short name (the same act section or website is listed once). */
function shortSources(sources: Source[]) {
  const byLabel = new Map<string, string>();
  for (const source of sources) {
    const label = sourceLabel(source.url, source.ref);
    if (!byLabel.has(label)) byLabel.set(label, source.url);
  }
  return [...byLabel].map(([label, url]) => ({ label, url }));
}

/** "How is this calculated?": each topic as a box that opens, with the user's own numbers. */
export function Explanations({ topics }: { topics: ExplainTopic[] }) {
  const t = useTranslations("finance.explain");
  const format = useFormatter();

  function show(v: ExplainValue): string {
    switch (v.kind) {
      case "eur":
        return format.number(v.value, {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: Number.isInteger(v.value) ? 0 : 2,
          maximumFractionDigits: 2,
        });
      case "percent":
        return format.number(v.value, { style: "percent", maximumFractionDigits: 3 });
      case "ratio":
        return format.number(v.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case "number":
        return format.number(v.value, { useGrouping: false, maximumFractionDigits: 2 });
    }
  }

  if (topics.length === 0) return null;
  // The same topic can appear more than once (one box per employee or investment); only the first gets the anchor.
  const anchored = new Set<TopicId>();

  return (
    <section className="space-y-3" aria-labelledby="explain-title">
      <div>
        <h3 id="explain-title" className="text-lg font-semibold text-slate-900">
          {t("title")}
        </h3>
        <p className="text-sm text-slate-600">{t("intro")}</p>
      </div>
      <div className="space-y-2">
        {topics.map((topic, index) => {
          const id = anchored.has(topic.id) ? undefined : explainAnchor(topic.id);
          anchored.add(topic.id);
          const title = t(`topics.${topic.id}`) + (topic.subject?.trim() ? ` — ${topic.subject.trim()}` : "");
          return (
            <details key={`${topic.id}-${index}`} id={id} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer font-medium text-slate-900">{title}</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-6 text-sm text-slate-800">
                {topic.steps.map((step, stepIndex) => (
                  <li key={stepIndex}>
                    {t(
                      `steps.${step.key}`,
                      Object.fromEntries(Object.entries(step.values).map(([name, value]) => [name, show(value)])),
                    )}
                  </li>
                ))}
              </ol>
              {topic.sources.length > 0 && (
                <p className="mt-2 text-xs text-slate-600">
                  {t("sources")}{" "}
                  {shortSources(topic.sources).map((source, sourceIndex) => (
                    <span key={source.label}>
                      {sourceIndex > 0 && "; "}
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                        {source.label}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </details>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">{t("note")}</p>
    </section>
  );
}

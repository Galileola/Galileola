import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

type Props = { searchParams: Promise<{ deleted?: string }> };

export default async function HomePage({ searchParams }: Props) {
  const { deleted } = await searchParams;
  const t = await getTranslations("home");

  const features = [
    { title: t("feature1Title"), text: t("feature1Text") },
    { title: t("feature2Title"), text: t("feature2Text") },
    { title: t("feature3Title"), text: t("feature3Text") },
  ];

  return (
    <div className="space-y-10">
      {deleted === "1" && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-green-900">
          {t("deleted")}
        </p>
      )}

      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{t("title")}</h1>
        <p className="max-w-2xl text-lg text-slate-700">{t("intro")}</p>
        <Link
          href="/plans"
          className="inline-block rounded-md bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800"
        >
          {t("start")}
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="font-semibold text-slate-900">{feature.title}</h2>
            <p className="mt-2 text-sm text-slate-700">{feature.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

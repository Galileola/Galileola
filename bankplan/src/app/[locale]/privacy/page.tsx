import { getTranslations } from "next-intl/server";

/**
 * The privacy notice. Who runs the service comes from two settings in the hosting
 * (SITE_OPERATOR_NAME and SITE_CONTACT_EMAIL), so it can be filled in without changing code.
 */
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  const operator = process.env.SITE_OPERATOR_NAME?.trim();
  const contact = process.env.SITE_CONTACT_EMAIL?.trim();

  const parts = [
    ...(operator && contact ? [{ title: t("operatorTitle"), text: t("operatorText", { name: operator, email: contact }) }] : []),
    { title: t("whatTitle"), text: t("whatText") },
    { title: t("whereTitle"), text: t("whereText") },
    { title: t("aiTitle"), text: t("aiText") },
    { title: t("cookiesTitle"), text: t("cookiesText") },
    { title: t("keepTitle"), text: t("keepText") },
    { title: t("deleteTitle"), text: t("deleteText") },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      {!(operator && contact) && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">{t("draftNote")}</p>
      )}
      {parts.map((part) => (
        <section key={part.title} className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">{part.title}</h2>
          <p className="text-slate-700">{part.text}</p>
        </section>
      ))}
    </div>
  );
}

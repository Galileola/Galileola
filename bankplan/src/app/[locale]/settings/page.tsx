import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { logOut } from "./actions";
import { DeleteAccountForm } from "./DeleteAccountForm";

type Props = { params: Promise<{ locale: string }> };

export default async function SettingsPage({ params }: Props) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const t = await getTranslations("settings");

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">{t("account")}</h2>
        {user.email && <p className="text-slate-700">{t("signedInAs", { email: user.email })}</p>}
        <form action={logOut}>
          <input type="hidden" name="locale" value={locale} />
          <SubmitButton label={t("logout")} pendingLabel={t("logout")} variant="secondary" />
        </form>
      </section>

      <section className="space-y-3 rounded-lg border border-red-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-red-800">{t("deleteTitle")}</h2>
        <p className="text-slate-700">{t("deleteText")}</p>
        <DeleteAccountForm />
      </section>
    </div>
  );
}

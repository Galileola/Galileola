import { getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const t = await getTranslations("login");

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      <p className="text-slate-700">{t("intro")}</p>
      {error === "link" && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
          {t("errorLink")}
        </p>
      )}
      <LoginForm />
    </div>
  );
}

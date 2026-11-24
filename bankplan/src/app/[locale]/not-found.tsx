import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
      <Link href="/" className="text-blue-700 underline">
        {t("back")}
      </Link>
    </div>
  );
}

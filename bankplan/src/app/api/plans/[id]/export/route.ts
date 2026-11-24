import { getTranslations } from "next-intl/server";
import { companyTypes, type CompanyType } from "@/config/countries/ee";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth";
import { buildPlanDocument, type Translate } from "@/lib/export/buildDocument";
import { toDocx } from "@/lib/export/toDocx";
import { toPdf } from "@/lib/export/toPdf";
import { readPlanAnswers } from "@/lib/plan/answers";
import { getMyPlanFull } from "@/lib/plans";

/**
 * Download of the plan: /api/plans/<id>/export?format=docx|pdf&lang=et|ru|en
 * Only the owner gets the file (row-level security in the database).
 */
const FILE_TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const lang = url.searchParams.get("lang");
  if ((format !== "docx" && format !== "pdf") || !hasLocale(routing.locales, lang)) {
    return new Response("Bad request", { status: 400 });
  }

  if (!(await getCurrentUser())) return new Response("Not signed in", { status: 401 });
  const plan = await getMyPlanFull(id);
  if (!plan) return new Response("Not found", { status: 404 });

  const companyType: CompanyType = (companyTypes as readonly string[]).includes(plan.company_type)
    ? (plan.company_type as CompanyType)
    : "OU";
  const t = await getTranslations({ locale: lang });
  const doc = buildPlanDocument(
    { title: plan.title, companyType, answers: readPlanAnswers(plan.answers), finance: plan.finance },
    lang,
    t as unknown as Translate,
    new Date(),
  );

  try {
    const file = format === "docx" ? await toDocx(doc) : await toPdf(doc);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": FILE_TYPES[format],
        "Content-Disposition": contentDisposition(plan.title, format),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // Only the error type goes to the logs, never the plan content.
    console.error("Export failed", { format, type: error instanceof Error ? error.name : "unknown" });
    return new Response("Export failed", { status: 500 });
  }
}

/** File name from the plan title, e.g. "Kohvik Tartus.pdf" (with a plain-ASCII fallback). */
function contentDisposition(title: string, format: "docx" | "pdf") {
  const name = title.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "plan";
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim() || "plan";
  return `attachment; filename="${ascii}.${format}"; filename*=UTF-8''${encodeURIComponent(`${name}.${format}`)}`;
}

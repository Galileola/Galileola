import { mkdirSync, writeFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { Locale } from "@/i18n/routing";
import { defaultFinanceInputs } from "@/lib/finance/inputs";
import { textHash, type PlanAnswers } from "@/lib/plan/answers";
import en from "@/messages/en.json";
import et from "@/messages/et.json";
import ru from "@/messages/ru.json";
import { buildPlanDocument, sectionsNeedingTranslation, type PlanForExport, type Translate } from "./buildDocument";
import { textToBlocks } from "./model";
import { toDocx } from "./toDocx";
import { toPdf } from "./toPdf";

const messages = { en, et, ru };
function translator(locale: Locale): Translate {
  const t = createTranslator({ locale, messages: messages[locale] });
  return (key, values) => (t as unknown as Translate)(key, values);
}

const ideaText = "Pakume kohvi, värskeid saiakesi ja lõunat.\n\n- Lõuna 6,50 €\n- Kohv 2,80 €";
const answers: PlanAnswers = {
  idea: { q: {}, text: ideaText, textLocale: "et" },
  market: { q: {}, text: "Главные конкуренты: кафе A и пекарня B.", textLocale: "ru" },
};
const plan: PlanForExport = {
  title: "Kohvik Tartus",
  companyType: "OU",
  answers,
  finance: {
    ...defaultFinanceInputs(new Date("2026-12-15")),
    startMonth: "2027-01",
    revenue: [{ id: "r", name: "Kohvik", vatPercent: 24, directCostPercent: 40, year1: Array(12).fill(10000), year2Total: 120000, year3Total: 120000 }],
    loan: { amount: 12000, annualInterestPercent: 12, termMonths: 12, type: "equalPrincipal", graceMonths: 0, disbursementMonth: 1, contractFeePercent: 0 },
    ownContribution: 5000,
  },
};
const now = new Date("2026-11-24T10:00:00Z");

describe("section text to blocks", () => {
  it("splits paragraphs and bullet lists", () => {
    expect(textToBlocks(ideaText)).toEqual([
      { type: "paragraph", text: "Pakume kohvi, värskeid saiakesi ja lõunat." },
      { type: "bullets", items: ["Lõuna 6,50 €", "Kohv 2,80 €"] },
    ]);
  });
});

describe("plan document", () => {
  it("has all 11 sections, the numbers and both appendices", () => {
    const doc = buildPlanDocument(plan, "et", translator("et"), now);
    const headings = doc.blocks.filter((b) => b.type === "heading").map((b) => (b as { text: string }).text);
    expect(headings).toContain("2. Äriidee");
    expect(headings).toContain("12. Finantsprognoos");
    expect(headings).toContain("Lisa A. Kuidas numbrid on arvutatud");
    expect(headings).toContain("Lisa B. Laenu maksegraafik");
    // Empty sections are flagged, not hidden.
    expect(doc.blocks).toContainEqual({ type: "note", text: "See osa on veel kirjutamata." });
    // The Russian text in an Estonian document is marked as not translated.
    expect(doc.blocks).toContainEqual({ type: "note", text: "Tõlkimata: see tekst on vene keeles." });
    // Year 1 DSCR: EBITDA 120 000 − 48 000 = 72 000 ÷ (principal 11 000 + interest 770) = 6,12.
    const keyTable = doc.blocks.find((b) => b.type === "table" && b.title === "Panga jaoks olulised näitajad");
    expect(keyTable && keyTable.type === "table" && keyTable.rows[0].values[0]).toBe("6,12");
  });

  it("uses a stored translation only while it matches the text", () => {
    const translated: PlanAnswers = {
      ...answers,
      market: { ...answers.market!, translations: { et: { text: "Konkurendid: kohvik A ja pagarikoda B.", sourceHash: textHash(answers.market!.text) } } },
    };
    expect(sectionsNeedingTranslation(answers, "et")).toEqual(["market"]);
    expect(sectionsNeedingTranslation(translated, "et")).toEqual([]);
    const stale: PlanAnswers = { ...translated, market: { ...translated.market!, text: "Changed text" } };
    expect(sectionsNeedingTranslation(stale, "et")).toEqual(["market"]);
  });

  it("writes a Word file and a PDF with Estonian and Russian letters", async () => {
    const out = process.env.EXPORT_SAMPLE_DIR;
    for (const locale of ["et", "ru"] as const) {
      const doc = buildPlanDocument(plan, locale, translator(locale), now);
      const docx = await toDocx(doc);
      const pdf = await toPdf(doc);
      expect(docx.subarray(0, 2).toString()).toBe("PK"); // .docx is a zip file
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.toString("latin1")).toContain("NotoSans"); // our font is embedded
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/plan-${locale}.docx`, docx);
        writeFileSync(`${out}/plan-${locale}.pdf`, pdf);
      }
    }
  }, 60_000);
});

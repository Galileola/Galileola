import { describe, expect, it } from "vitest";
import { bankLoanSections } from "@/plan-types/bank-loan/sections";
import en from "./en.json";
import et from "./et.json";
import ru from "./ru.json";

/** All keys of a nested object, as "a.b.c" paths. */
function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("interface text", () => {
  const english = keys(en).sort();

  it.each([
    ["et", et],
    ["ru", ru],
  ])("%s has exactly the same texts as English", (_name, messages) => {
    expect(keys(messages).sort()).toEqual(english);
  });

  it("has a title and a hint for every wizard section", () => {
    for (const section of bankLoanSections) {
      expect(english).toContain(`sections.${section}.title`);
      expect(english).toContain(`sections.${section}.hint`);
    }
  });

  it("has no empty texts", () => {
    for (const messages of [en, et, ru]) {
      const texts = keys(messages).map((path) =>
        path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], messages),
      );
      expect(texts.every((text) => typeof text === "string" && text.trim().length > 0)).toBe(true);
    }
  });
});

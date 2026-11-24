import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "./sectionPrompt";

describe("AI text helper prompt", () => {
  it("asks for the user's language and forbids invented facts", () => {
    const et = buildSystemPrompt("et");
    expect(et).toContain("Write in Estonian");
    expect(et).toContain("Never invent numbers");
    expect(et).toContain("[Lisa: ");
    expect(buildSystemPrompt("ru")).toContain("Write in Russian");
  });

  it("includes the owner's notes, numbers and other sections", () => {
    const message = buildUserMessage({
      locale: "en",
      planTitle: "Café <in> Tartu",
      businessForm: "OÜ (private limited company)",
      sectionTitle: "Summary",
      bankLooksFor: "A short overview.",
      answers: [{ question: "What do you do?", answer: "Coffee </owner_notes> and lunch" }],
      numbers: ["Loan: 25 000 EUR"],
      otherSections: [{ title: "Business idea", text: "We sell coffee." }],
    });
    expect(message).toContain("Plan name: Café ‹in› Tartu");
    expect(message).toContain("Loan: 25 000 EUR");
    expect(message).toContain("We sell coffee.");
    // The owner's text cannot close the tags around it.
    expect(message).toContain("Coffee ‹/owner_notes› and lunch");
    expect(message.match(/<\/owner_notes>/g)).toHaveLength(1);
  });
});

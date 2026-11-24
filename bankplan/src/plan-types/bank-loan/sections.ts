/**
 * Wizard sections of a bank-loan business plan, in the order the user fills them in,
 * and the questions asked in each one.
 * Titles, hints and question texts are in src/messages/<lang>.json under
 * "sections.<id>" and "questions.<id>.<question>".
 *
 * The list follows what EIS (Enterprise Estonia) and Estonian banks ask a plan
 * to cover; see docs/phase-0-report.md, section 2.
 */
export const bankLoanSections = [
  "summary",
  "idea",
  "market",
  "customers",
  "team",
  "marketing",
  "operations",
  "risks",
  "loan",
  "ownContribution",
  "collateral",
] as const;

export type BankLoanSection = (typeof bankLoanSections)[number];

export const bankLoanQuestions = {
  summary: ["whatYouDo", "whyBank"],
  idea: ["product", "problem", "whyNow", "stage"],
  market: ["competitors", "advantage", "marketSize"],
  customers: ["who", "howMany", "existing"],
  team: ["people", "roles"],
  marketing: ["channels", "prices", "salesProcess"],
  operations: ["location", "suppliers", "permits"],
  risks: ["risks", "mitigation"],
  loan: ["use", "amountTerm", "repayment"],
  ownContribution: ["amount", "source"],
  collateral: ["security", "eisGuarantee", "existingDebts"],
} as const satisfies Record<BankLoanSection, readonly string[]>;

/** Sections whose AI text also uses the numbers from the calculator. */
export const sectionsUsingNumbers: readonly BankLoanSection[] = ["summary", "loan", "ownContribution"];

export function isBankLoanSection(value: string): value is BankLoanSection {
  return (bankLoanSections as readonly string[]).includes(value);
}

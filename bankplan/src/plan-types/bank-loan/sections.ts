/**
 * Wizard sections of a bank-loan business plan, in the order the user fills them in.
 * Titles and hints are in src/messages/<lang>.json under "sections.<id>".
 * Questions for each section are added in Phase 3.
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

export function isBankLoanSection(value: string): value is BankLoanSection {
  return (bankLoanSections as readonly string[]).includes(value);
}

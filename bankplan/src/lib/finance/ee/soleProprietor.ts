import { round2 } from "../money";

/** Input for one calendar year (or the part of it inside the forecast). */
export type FieYearInput = {
  /** Business income minus business costs, before the owner's own taxes. */
  profit: number;
  /** Sum of the social tax monthly base over the months in business (12 × base for a full year). */
  socialTaxMinBaseSum: number;
  /** Sum of the minimum monthly wage over the months in business. */
  minimumWageSum: number;
  /** Tax-free income available for these months (0 if used elsewhere). */
  exemption: number;
  /** 0 if not in the II pillar, otherwise 0.02, 0.04 or 0.06. */
  fundedPensionRate: number;
  rates: {
    socialTax: number;
    incomeTax: number;
    /** 1.33 in TuMS § 14 lg 5³. */
    socialTaxDivisor: number;
    /** 10 in SMS § 2 lg 1 p 5. */
    maxBaseMinimumWages: number;
  };
};

export type FieYearTaxes = {
  socialTax: number;
  /** Profit after the FIE's own social tax (the base for pension and income tax). */
  taxableIncome: number;
  fundedPension: number;
  incomeTax: number;
  total: number;
};

/**
 * An FIE's own taxes for a year (SMS § 2 lg 1 p 5 and lg 5; TuMS § 14 lg 5³–5⁵, § 28¹).
 *
 * 1. Social tax = 33% of profit ÷ 1.33, but at least the minimum and at most the maximum.
 * 2. Taxable income = profit − that social tax (equals profit ÷ 1.33 in the normal case).
 * 3. Funded pension = rate × taxable income, capped by the same maximum base.
 * 4. Income tax = 22% × (taxable income − funded pension − tax-free income).
 */
export function fieYearTaxes(input: FieYearInput): FieYearTaxes {
  const { profit, rates } = input;
  const maxBase = rates.maxBaseMinimumWages * input.minimumWageSum;
  const minimumSocialTax = round2(input.socialTaxMinBaseSum * rates.socialTax);
  const maximumSocialTax = round2(maxBase * rates.socialTax);
  const normalSocialTax = round2((Math.max(profit, 0) / rates.socialTaxDivisor) * rates.socialTax);
  const socialTax = Math.min(Math.max(normalSocialTax, minimumSocialTax), maximumSocialTax);

  const taxableIncome = round2(Math.max(0, profit - socialTax));
  const fundedPension = round2(Math.min(taxableIncome, maxBase) * input.fundedPensionRate);
  const incomeTax = round2(Math.max(0, taxableIncome - fundedPension - input.exemption) * rates.incomeTax);

  return {
    socialTax,
    taxableIncome,
    fundedPension,
    incomeTax,
    total: round2(socialTax + fundedPension + incomeTax),
  };
}

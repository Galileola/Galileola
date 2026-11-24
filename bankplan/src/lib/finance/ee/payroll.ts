import { round2 } from "../money";

/** Estonian payroll rates for one month, read from config/countries/ee.ts. */
export type PayrollRates = {
  incomeTax: number;
  /** Tax-free income per month, used when the person asked for it (TuMS § 42 lg 1). */
  exemptionMonthly: number;
  socialTax: number;
  socialTaxMinBase: number;
  unemploymentEmployee: number;
  unemploymentEmployer: number;
  fundedPension: number;
};

export type PayslipOptions = {
  /** Employer pays social tax on at least the monthly base (SMS § 2 lg 2). */
  applyMinimumSocialTax: boolean;
  /** False for an OÜ board member (TKindlS § 3 lg 2 p 3). */
  unemploymentInsurance: boolean;
};

export type Payslip = {
  gross: number;
  socialTax: number;
  unemploymentEmployer: number;
  unemploymentEmployee: number;
  fundedPension: number;
  incomeTax: number;
  /** Paid to the person. */
  net: number;
  /** Taken from the gross and paid to the tax board by the employer. */
  withheld: number;
  /** Gross + employer taxes: what the business pays in total. */
  employerCost: number;
};

/**
 * One person's monthly pay.
 * Income tax base = gross − employee unemployment insurance − funded pension − tax-free income
 * (TuMS § 42 lg 1, 5, 6).
 */
export function monthlyPayslip(gross: number, options: PayslipOptions, rates: PayrollRates): Payslip {
  const socialTaxBase = options.applyMinimumSocialTax ? Math.max(gross, rates.socialTaxMinBase) : gross;
  const socialTax = round2(socialTaxBase * rates.socialTax);
  const unemploymentEmployer = options.unemploymentInsurance ? round2(gross * rates.unemploymentEmployer) : 0;
  const unemploymentEmployee = options.unemploymentInsurance ? round2(gross * rates.unemploymentEmployee) : 0;
  const fundedPension = round2(gross * rates.fundedPension);
  const taxable = Math.max(0, gross - unemploymentEmployee - fundedPension - rates.exemptionMonthly);
  const incomeTax = round2(taxable * rates.incomeTax);
  const withheld = round2(unemploymentEmployee + fundedPension + incomeTax);

  return {
    gross,
    socialTax,
    unemploymentEmployer,
    unemploymentEmployee,
    fundedPension,
    incomeTax,
    net: round2(gross - withheld),
    withheld,
    employerCost: round2(gross + socialTax + unemploymentEmployer),
  };
}

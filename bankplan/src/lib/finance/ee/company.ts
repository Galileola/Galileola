import { round2 } from "../money";

/**
 * Corporate income tax an OÜ pays when it pays out a dividend (TuMS § 4, § 50):
 * net dividend ÷ 0.78 × 22%. Profit kept in the company is not taxed.
 */
export function dividendTax(netDividend: number, rate: number, grossUpDivisor: number): number {
  if (netDividend <= 0) return 0;
  return round2((netDividend / grossUpDivisor) * rate);
}

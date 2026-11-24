import { round2 } from "./money";

export type LoanType = "annuity" | "equalPrincipal";

export type LoanTerms = {
  amount: number;
  /** Yearly interest as a fraction, e.g. 0.08 for 8%. */
  annualRate: number;
  termMonths: number;
  type: LoanType;
  /** First months with interest only ("maksepuhkus"). */
  graceMonths: number;
};

export type LoanPayment = {
  /** 1 = first payment, one month after the money is paid out. */
  number: number;
  interest: number;
  principal: number;
  payment: number;
  balanceAfter: number;
};

/**
 * Monthly repayment schedule.
 * - Annuity: the same payment every month (after any interest-only months).
 * - Equal principal: the same principal every month, interest falls over time.
 * Amounts are rounded to cents; the last payment clears what is left.
 */
export function loanSchedule(terms: LoanTerms): LoanPayment[] {
  const { amount, annualRate, termMonths, type, graceMonths } = terms;
  if (amount <= 0 || termMonths <= 0) return [];
  if (graceMonths >= termMonths) throw new Error("Interest-only months must be fewer than the loan term");

  const monthlyRate = annualRate / 12;
  const repaymentMonths = termMonths - graceMonths;
  const annuityPayment =
    monthlyRate === 0
      ? round2(amount / repaymentMonths)
      : round2((amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -repaymentMonths)));
  const equalPrincipal = round2(amount / repaymentMonths);

  const payments: LoanPayment[] = [];
  let balance = amount;

  for (let number = 1; number <= termMonths; number++) {
    const interest = round2(balance * monthlyRate);
    let principal: number;
    if (number <= graceMonths) {
      principal = 0;
    } else if (number === termMonths) {
      principal = balance;
    } else if (type === "annuity") {
      principal = Math.min(balance, round2(annuityPayment - interest));
    } else {
      principal = Math.min(balance, equalPrincipal);
    }
    balance = round2(balance - principal);
    payments.push({ number, interest, principal, payment: round2(interest + principal), balanceAfter: balance });
  }
  return payments;
}

import type { Rule } from "@/config/types";

/**
 * Value of a rule on a given day (YYYY-MM-DD).
 * `assumed` is true when the value is not confirmed for that day: either the
 * period itself is marked 'assumed', or the day is after `knownUntil`.
 */
export function valueAt<T>(rule: Rule<T>, date: string): { value: T; assumed: boolean } {
  let current: Rule<T>["periods"][number] | undefined;
  for (const period of rule.periods) {
    if (period.from <= date) current = period;
  }
  if (!current) throw new Error(`No value for "${rule.label}" on ${date}`);
  const assumed =
    current.certainty === "assumed" || (rule.knownUntil !== undefined && date > rule.knownUntil);
  return { value: current.value, assumed };
}

/** A rule value that was used but is not confirmed yet, e.g. 2027's social tax base. */
export type Assumption = { rule: string; year: number };

/** Reads rule values and remembers which ones were assumptions. */
export class RuleReader {
  private used = new Map<string, Assumption>();

  read<T>(id: string, rule: Rule<T>, date: string): T {
    const { value, assumed } = valueAt(rule, date);
    if (assumed) {
      const year = Number(date.slice(0, 4));
      this.used.set(`${id}:${year}`, { rule: id, year });
    }
    return value;
  }

  assumptions(): Assumption[] {
    return [...this.used.values()].sort((a, b) => a.year - b.year || a.rule.localeCompare(b.rule));
  }
}

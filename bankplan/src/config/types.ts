/**
 * Shared shapes for country rule files.
 *
 * Every number the calculator uses (tax rates, thresholds, bank benchmarks)
 * lives in ONE file per country under ./countries/ (for example ee.ts).
 * The calculation code never contains these numbers. It reads them through
 * the types below, so each value always carries its source and check date.
 */

/** How sure we are about a value. */
export type Certainty =
  /** Read in the text of an act that is in force (or adopted and in force from `from`). */
  | 'law'
  /** Stated on an official page (tax board, agency, bank). Not checked in an act. */
  | 'official'
  /**
   * Not fixed yet for that period. We reuse the closest known value and the app
   * must label it as an assumption.
   */
  | 'assumed';

export interface Source {
  /** Official page the value was checked against. */
  url: string;
  /** Exact place: section of an act or heading on a page, e.g. "KMS § 15 lg 1". */
  ref?: string;
  /** Date we opened the source and confirmed the value (YYYY-MM-DD). */
  checked: string;
}

/** One value that applies from `from` until the next period starts. */
export interface Period<T> {
  /** First day the value applies (YYYY-MM-DD). */
  from: string;
  value: T;
  certainty: Certainty;
  sources: Source[];
  note?: string;
}

export type Unit =
  | 'rate'
  | 'EUR'
  | 'EUR/month'
  | 'EUR/year'
  | 'day of month'
  | 'multiplier'
  | 'months'
  | 'ratio';

/** A value that can change over time. Periods are sorted oldest first. */
export interface Rule<T> {
  /** Plain-English description, also used in the export appendix. */
  label: string;
  unit: Unit;
  periods: Period<T>[];
  /**
   * Last day the newest value is known to be valid. Set it for values that are
   * fixed one year at a time (for example by the State Budget Act). After this
   * day the calculator treats the value as 'assumed'.
   * Leave it out when the law sets no end date.
   */
  knownUntil?: string;
}

/** A single value with its source, for things that do not change by date. */
export interface Sourced<T> {
  label: string;
  value: T;
  certainty: Certainty;
  sources: Source[];
  note?: string;
}

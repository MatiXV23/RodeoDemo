import { D, Decimal, type Numeric } from "../decimal";
import { addDays } from "../dates";

export const DEFAULT_HORIZONS = [30, 60, 90, 180] as const;

export function projectWeight(current: Numeric, gdpPerDay: Numeric, days: number): Decimal {
  return D(current).plus(D(gdpPerDay).times(days));
}

/** Días para alcanzar un peso objetivo a una GDP dada; null si no es alcanzable. */
export function daysToTarget(current: Numeric, target: Numeric, gdpPerDay: Numeric): number | null {
  const gap = D(target).minus(D(current));
  if (gap.lte(0)) return 0;
  const g = D(gdpPerDay);
  if (g.lte(0)) return null;
  return gap.div(g).ceil().toNumber();
}

export type ProjectionPoint = { days: number; date: string; weight: Decimal };

export function projectionTable(
  current: Numeric,
  gdpPerDay: Numeric,
  fromDate: string,
  horizons: readonly number[] = DEFAULT_HORIZONS,
): ProjectionPoint[] {
  return horizons.map((days) => ({ days, date: addDays(fromDate, days), weight: projectWeight(current, gdpPerDay, days) }));
}

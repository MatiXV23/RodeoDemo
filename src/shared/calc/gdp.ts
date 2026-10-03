import { D, Decimal, ZERO, div, type Numeric } from "../decimal";
import { daysBetween } from "../dates";

export type WeightPoint = { date: string; weight: Numeric };

/** GDP entre dos pesadas: (peso2 − peso1) / días. Null si no hay días entre medio. */
export function gdpBetween(w1: Numeric, d1: string, w2: Numeric, d2: string): Decimal | null {
  const days = daysBetween(d1, d2);
  if (days <= 0) return null;
  return D(w2).minus(D(w1)).div(days);
}

export type Trend = { slopePerDay: Decimal; intercept: Decimal; points: number; from: string; to: string };

/**
 * Tendencia por regresión lineal simple sobre las últimas N pesadas.
 * Aislada a propósito: es el único lugar a cambiar si se quiere otro modelo
 * (media móvil, regresión robusta, etc.).
 */
export function linearTrend(points: WeightPoint[], lastN = 4): Trend | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date)).slice(-lastN);
  if (sorted.length < 2) return null;
  const origin = sorted[0].date;
  const xs = sorted.map((p) => D(daysBetween(origin, p.date)));
  const ys = sorted.map((p) => D(p.weight));
  const n = D(sorted.length);
  const meanX = xs.reduce((a, b) => a.plus(b), ZERO).div(n);
  const meanY = ys.reduce((a, b) => a.plus(b), ZERO).div(n);
  let num = ZERO;
  let den = ZERO;
  for (let i = 0; i < sorted.length; i++) {
    const dx = xs[i].minus(meanX);
    num = num.plus(dx.times(ys[i].minus(meanY)));
    den = den.plus(dx.times(dx));
  }
  if (den.isZero()) return null; // todas las pesadas el mismo día
  const slope = num.div(den);
  return {
    slopePerDay: slope,
    intercept: meanY.minus(slope.times(meanX)),
    points: sorted.length,
    from: origin,
    to: sorted[sorted.length - 1].date,
  };
}

export type AnimalGdp = {
  lastGdp: Decimal | null; // entre las últimas dos pesadas
  periodGdp: Decimal | null; // entre la primera y la última del período
  trendGdp: Decimal | null; // pendiente de la regresión
  firstWeight: Decimal | null;
  lastWeight: Decimal | null;
  firstDate: string | null;
  lastDate: string | null;
  days: number;
  kgGained: Decimal;
};

/** Resume la evolución de un animal a partir de sus pesadas (cualquier orden). */
export function animalGdp(points: WeightPoint[], lastN = 4): AnimalGdp {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    return { lastGdp: null, periodGdp: null, trendGdp: null, firstWeight: null, lastWeight: null, firstDate: null, lastDate: null, days: 0, kgGained: ZERO };
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const trend = linearTrend(sorted, lastN);
  return {
    lastGdp: prev ? gdpBetween(prev.weight, prev.date, last.weight, last.date) : null,
    periodGdp: sorted.length >= 2 ? gdpBetween(first.weight, first.date, last.weight, last.date) : null,
    trendGdp: trend?.slopePerDay ?? null,
    firstWeight: D(first.weight),
    lastWeight: D(last.weight),
    firstDate: first.date,
    lastDate: last.date,
    days: daysBetween(first.date, last.date),
    kgGained: D(last.weight).minus(D(first.weight)),
  };
}

/**
 * GDP del lote: promedio ponderado por días de cada animal con al menos dos
 * pesadas en el período. Devuelve también los kilos producidos (suma de
 * ganancias individuales) y el peso promedio de la última pesada.
 */
export function lotGdp(animals: AnimalGdp[]) {
  let weightedSum = ZERO;
  let totalDays = ZERO;
  let kg = ZERO;
  let trendSum = ZERO;
  let trendCount = 0;
  let withData = 0;
  for (const a of animals) {
    if (a.periodGdp && a.days > 0) {
      weightedSum = weightedSum.plus(a.periodGdp.times(a.days));
      totalDays = totalDays.plus(a.days);
      kg = kg.plus(a.kgGained);
      withData++;
    }
    if (a.trendGdp) {
      trendSum = trendSum.plus(a.trendGdp);
      trendCount++;
    }
  }
  return {
    gdp: totalDays.isZero() ? null : weightedSum.div(totalDays),
    trendGdp: trendCount ? trendSum.div(trendCount) : null,
    kgProduced: kg,
    animalsWithData: withData,
  };
}

/** Peso promedio y total de un conjunto de últimos pesos. */
export function averageWeight(weights: Numeric[]) {
  const valid = weights.filter((w) => w !== null && w !== undefined && w !== "");
  const total = valid.reduce<Decimal>((a, b) => a.plus(D(b)), ZERO);
  return { total, average: div(total, valid.length), count: valid.length };
}

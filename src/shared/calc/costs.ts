import { D, Decimal, ZERO, div, type Numeric } from "../decimal";

export type AllocationMethod = "head_days" | "heads";

export type LotShare = { lotId: string; headDays: Numeric; heads: Numeric };

/**
 * Prorratea un importe global entre lotes según cabeza-día (por defecto) o
 * cabezas. Redondea a 2 decimales y asigna el residuo por "mayor resto" para
 * que la suma de las partes sea exactamente el total.
 */
export function allocateGlobal(total: Numeric, shares: LotShare[], method: AllocationMethod = "head_days"): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  const amount = D(total);
  const weights = shares.map((s) => D(method === "heads" ? s.heads : s.headDays));
  const sumW = weights.reduce((a, b) => a.plus(b), ZERO);
  if (sumW.lte(0) || amount.isZero()) {
    for (const s of shares) out.set(s.lotId, ZERO);
    return out;
  }
  const exact = weights.map((w) => amount.times(w).div(sumW));
  const floored = exact.map((e) => e.toDecimalPlaces(2, Decimal.ROUND_DOWN));
  let remainder = amount.minus(floored.reduce((a, b) => a.plus(b), ZERO)).toDecimalPlaces(2);
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(floored[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac));
  const cent = new Decimal("0.01");
  for (const { i } of order) {
    if (remainder.lte(0)) break;
    floored[i] = floored[i].plus(cent);
    remainder = remainder.minus(cent);
  }
  shares.forEach((s, i) => out.set(s.lotId, floored[i]));
  return out;
}

/** Cabeza-día de un animal entre dos fechas (ambas inclusive en el extremo inicial). */
export function headDays(from: string, to: string | null, periodFrom: string, periodTo: string): number {
  const start = from > periodFrom ? from : periodFrom;
  const end = to && to < periodTo ? to : periodTo;
  const ms = Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z");
  return ms > 0 ? Math.round(ms / 86400000) : 0;
}

export type LotCostInput = {
  purchaseCost: Numeric; // suma de costos de compra de los animales del lote
  directExpenses: Numeric; // gastos imputados directamente (ya multiplicados por %)
  allocatedExpenses: Numeric; // prorrateo de gastos globales
  headCount: number; // cabezas actuales (o al cierre)
  kgProduced: Numeric; // kilos producidos en el período
  deaths?: number;
};

export type LotCostResult = {
  purchaseCost: Decimal;
  direct: Decimal;
  allocated: Decimal;
  expenses: Decimal; // direct + allocated
  total: Decimal; // purchase + expenses
  perHead: Decimal;
  costPerKgProduced: Decimal | null; // gastos (sin compra) / kg producidos
  fullCostPerKgProduced: Decimal | null; // total / kg producidos
};

export function lotCosts(i: LotCostInput): LotCostResult {
  const purchaseCost = D(i.purchaseCost);
  const direct = D(i.directExpenses);
  const allocated = D(i.allocatedExpenses);
  const expenses = direct.plus(allocated);
  const total = purchaseCost.plus(expenses);
  const kg = D(i.kgProduced);
  return {
    purchaseCost,
    direct,
    allocated,
    expenses,
    total,
    perHead: div(total, i.headCount),
    costPerKgProduced: kg.gt(0) ? expenses.div(kg) : null,
    fullCostPerKgProduced: kg.gt(0) ? total.div(kg) : null,
  };
}

/** Costo diario por cabeza a partir de gastos recientes y cabeza-día del período. */
export function dailyCostPerHead(recentExpenses: Numeric, recentHeadDays: Numeric): Decimal {
  return div(recentExpenses, recentHeadDays);
}

/** Resultado de una venta: neto − costo acumulado asignado. */
export function saleResult(netRevenue: Numeric, allocatedCost: Numeric) {
  return D(netRevenue).minus(D(allocatedCost));
}

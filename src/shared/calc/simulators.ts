import { D, Decimal, ZERO, div, type Numeric } from "../decimal";
import { addDays } from "../dates";
import { projectWeight, daysToTarget } from "./projection";

export type SaleSimulationInput = {
  startDate: string;
  currentWeight: Numeric; // kg promedio por cabeza
  headCount: number;
  gdpPerDay: Numeric;
  dailyCostPerHead: Numeric;
  pricePerKg: Numeric;
  accumulatedCost: Numeric; // costo acumulado del lote a la fecha
  horizonDays?: number;
  stepDays?: number;
  priceSensitivity?: number; // 0.1 = ±10%
  commissionPct?: Numeric; // % sobre el bruto
};

export type SalePoint = {
  days: number;
  date: string;
  weight: Decimal;
  revenue: Decimal;
  cost: Decimal;
  margin: Decimal;
  marginPerHead: Decimal;
};

export type SaleSimulation = {
  curve: SalePoint[];
  best: SalePoint;
  today: SalePoint;
  sensitivity: { priceMinus: { price: Decimal; best: SalePoint }; pricePlus: { price: Decimal; best: SalePoint } };
  assumptions: {
    gdpPerDay: Decimal;
    dailyCostPerHead: Decimal;
    pricePerKg: Decimal;
    accumulatedCost: Decimal;
    headCount: number;
    currentWeight: Decimal;
    horizonDays: number;
    commissionPct: Decimal;
  };
};

function saleCurve(i: SaleSimulationInput, price: Decimal): SalePoint[] {
  const horizon = i.horizonDays ?? 180;
  const step = i.stepDays ?? 1;
  const heads = D(i.headCount);
  const commission = D(i.commissionPct ?? 0).div(100);
  const points: SalePoint[] = [];
  for (let days = 0; days <= horizon; days += step) {
    const weight = projectWeight(i.currentWeight, i.gdpPerDay, days);
    const gross = weight.times(heads).times(price);
    const revenue = gross.minus(gross.times(commission));
    const cost = D(i.accumulatedCost).plus(D(i.dailyCostPerHead).times(heads).times(days));
    const margin = revenue.minus(cost);
    points.push({ days, date: addDays(i.startDate, days), weight, revenue, cost, margin, marginPerHead: div(margin, heads) });
  }
  return points;
}

function bestOf(curve: SalePoint[]) {
  return curve.reduce((b, p) => (p.margin.gt(b.margin) ? p : b), curve[0]);
}

/**
 * Simulador de venta: para cada día hasta el horizonte, peso proyectado ×
 * precio − costo acumulado proyectado. Devuelve la curva, el día de margen
 * máximo y la sensibilidad al precio (±10% por defecto).
 */
export function simulateSale(i: SaleSimulationInput): SaleSimulation {
  const price = D(i.pricePerKg);
  const s = i.priceSensitivity ?? 0.1;
  const curve = saleCurve(i, price);
  const minus = price.times(1 - s);
  const plus = price.times(1 + s);
  return {
    curve,
    best: bestOf(curve),
    today: curve[0],
    sensitivity: {
      priceMinus: { price: minus, best: bestOf(saleCurve(i, minus)) },
      pricePlus: { price: plus, best: bestOf(saleCurve(i, plus)) },
    },
    assumptions: {
      gdpPerDay: D(i.gdpPerDay),
      dailyCostPerHead: D(i.dailyCostPerHead),
      pricePerKg: price,
      accumulatedCost: D(i.accumulatedCost),
      headCount: i.headCount,
      currentWeight: D(i.currentWeight),
      horizonDays: i.horizonDays ?? 180,
      commissionPct: D(i.commissionPct ?? 0),
    },
  };
}

export type PurchaseSimulationInput = {
  startDate: string;
  entryWeight: Numeric;
  purchasePrice: Numeric;
  purchasePriceMode: "kg" | "cabeza";
  expectedGdp: Numeric;
  dailyCostPerHead: Numeric;
  salePricePerKg: Numeric;
  targetWeight?: Numeric; // peso de venta deseado
  horizonDays?: number; // tope de permanencia
  extraCostsPerHead?: Numeric; // flete, comisión de compra, etc.
};

export type PurchaseSimulation = {
  purchaseCostPerHead: Decimal;
  daysToTarget: number | null;
  suggestedSaleDays: number;
  suggestedSaleDate: string;
  saleWeight: Decimal;
  kgProduced: Decimal;
  revenuePerHead: Decimal;
  feedingCostPerHead: Decimal;
  totalCostPerHead: Decimal;
  marginPerHead: Decimal;
  marginPerKgProduced: Decimal | null;
  costPerKgProduced: Decimal | null;
  breakevenSalePricePerKg: Decimal; // precio de venta que deja margen 0
  breakevenDays: number | null; // primer día con margen ≥ 0 (null si nunca en el horizonte)
  dailyMarginalGain: Decimal; // gdp × precio − costo diario
  assumptions: Record<string, string | number>;
};

/**
 * Simulador de compra por cabeza. Con GDP y precios constantes el margen es
 * lineal en el tiempo; se sugiere vender al alcanzar el peso objetivo (o al
 * horizonte si no se alcanza) y se informa el punto de equilibrio.
 */
export function simulatePurchase(i: PurchaseSimulationInput): PurchaseSimulation {
  const entry = D(i.entryWeight);
  const purchase = i.purchasePriceMode === "kg" ? entry.times(D(i.purchasePrice)) : D(i.purchasePrice);
  const extra = D(i.extraCostsPerHead ?? 0);
  const horizon = i.horizonDays ?? 365;
  const gdp = D(i.expectedGdp);
  const daily = D(i.dailyCostPerHead);
  const price = D(i.salePricePerKg);
  const toTarget = i.targetWeight ? daysToTarget(entry, i.targetWeight, gdp) : null;
  const days = toTarget !== null && toTarget <= horizon ? toTarget : horizon;
  const saleWeight = projectWeight(entry, gdp, days);
  const kg = saleWeight.minus(entry);
  const feeding = daily.times(days);
  const totalCost = purchase.plus(extra).plus(feeding);
  const revenue = saleWeight.times(price);
  const margin = revenue.minus(totalCost);
  const dailyMarginal = gdp.times(price).minus(daily);
  // margen(t) = (w0 + g t) p − compra − extra − c t ≥ 0  ⇒  t ≥ (compra + extra − w0 p) / (g p − c)
  let breakevenDays: number | null = null;
  const base = entry.times(price).minus(purchase).minus(extra);
  if (base.gte(0)) breakevenDays = 0;
  else if (dailyMarginal.gt(0)) {
    const t = base.neg().div(dailyMarginal).ceil().toNumber();
    breakevenDays = t <= horizon ? t : null;
  }
  return {
    purchaseCostPerHead: purchase,
    daysToTarget: toTarget,
    suggestedSaleDays: days,
    suggestedSaleDate: addDays(i.startDate, days),
    saleWeight,
    kgProduced: kg,
    revenuePerHead: revenue,
    feedingCostPerHead: feeding,
    totalCostPerHead: totalCost,
    marginPerHead: margin,
    marginPerKgProduced: kg.gt(0) ? margin.div(kg) : null,
    costPerKgProduced: kg.gt(0) ? feeding.plus(extra).div(kg) : null,
    breakevenSalePricePerKg: div(totalCost, saleWeight),
    breakevenDays,
    dailyMarginalGain: dailyMarginal,
    assumptions: {
      entryWeight: entry.toFixed(),
      purchasePrice: D(i.purchasePrice).toFixed(),
      purchasePriceMode: i.purchasePriceMode,
      expectedGdp: gdp.toFixed(),
      dailyCostPerHead: daily.toFixed(),
      salePricePerKg: price.toFixed(),
      targetWeight: i.targetWeight ? D(i.targetWeight).toFixed() : "",
      horizonDays: horizon,
      extraCostsPerHead: extra.toFixed(),
    },
  };
}

export { ZERO };

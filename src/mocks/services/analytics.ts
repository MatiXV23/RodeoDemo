// Proyecciones, simuladores y comparativa de lotes (port de apps/api/src/services/analytics.ts).

import { D, Decimal, ZERO, toNum, div } from "@rodeo/shared";
import { CATEGORY_LABELS, WEIGHT_RANGES, parseCategory, type Category } from "@rodeo/shared";
import { projectionTable, daysToTarget } from "@rodeo/shared";
import { simulateSale, simulatePurchase, type SaleSimulationInput, type PurchaseSimulationInput } from "@rodeo/shared";
import { assertCan, badRequest, notFound, type FarmCtx } from "../core";
import { loadFarmMetrics, type FarmMetrics, type LotMetrics } from "./metrics";
import { latestPrices, priceFor } from "./prices";

const num = (d: Decimal | null | undefined, dp = 2) => (d === null || d === undefined ? null : toNum(d, dp));

export function gdpForProjection(m: LotMetrics) {
  if (m.trendGdp && m.trendGdp.gt(0)) return { gdp: m.trendGdp, source: "tendencia (regresión sobre las últimas pesadas)" };
  if (m.gdp && m.gdp.gt(0)) return { gdp: m.gdp, source: "promedio del período" };
  return { gdp: ZERO, source: "sin datos suficientes (se asume 0)" };
}

export function lotProjection(m: LotMetrics, asOf: string) {
  const { gdp, source } = gdpForProjection(m);
  const current = m.avgWeight ?? ZERO;
  const target = m.lot.targetWeight ? D(m.lot.targetWeight) : null;
  return {
    gdpUsed: num(gdp, 3),
    gdpSource: source,
    currentWeight: num(current, 1),
    points: projectionTable(current, gdp, asOf).map((p) => ({ days: p.days, date: p.date, weight: toNum(p.weight, 1) })),
    daysToTarget: target ? daysToTarget(current, target, gdp) : null,
    targetWeight: target ? toNum(target, 1) : null,
  };
}

export type SaleSimulationParams = { horizonDays?: number; pricePerKg?: string | number | null; gdpPerDay?: string | number | null; dailyCostPerHead?: string | number | null; commissionPct?: string | number | null; stepDays?: number };

const given = (v: unknown) => v !== null && v !== undefined && v !== "";

export function saleSimulation(ctx: FarmCtx, lotId: string, params: SaleSimulationParams = {}) {
  assertCan(ctx.role, "read_money");
  const metrics = loadFarmMetrics(ctx);
  const m = metrics.lots.get(lotId);
  if (!m) throw notFound("El lote no existe en este campo.");
  const prices = latestPrices(ctx);
  if (!m.headCount) throw badRequest("El lote no tiene animales activos para simular.");
  const ref = priceFor(prices, m.lot.category);
  const price = given(params.pricePerKg) ? D(params.pricePerKg!) : ref?.price;
  if (!price || price.lte(0)) throw badRequest("No hay precio de referencia para esta categoría. Cargalo en Configuración o indicá uno.");
  const proj = gdpForProjection(m);
  const gdp = given(params.gdpPerDay) ? D(params.gdpPerDay!) : proj.gdp;
  const daily = given(params.dailyCostPerHead) ? D(params.dailyCostPerHead!) : m.dailyCostPerHead;
  const input: SaleSimulationInput = {
    startDate: metrics.asOf,
    currentWeight: m.avgWeight ?? ZERO,
    headCount: m.headCount,
    gdpPerDay: gdp,
    dailyCostPerHead: daily,
    pricePerKg: price,
    accumulatedCost: m.currentCost,
    horizonDays: Math.max(1, Math.min(365, Number(params.horizonDays) || 180)),
    stepDays: Math.max(1, Number(params.stepDays) || 1),
    commissionPct: params.commissionPct ?? 0,
  };
  const s = simulateSale(input);
  const point = (p: typeof s.best) => ({ days: p.days, date: p.date, weight: toNum(p.weight, 1), revenue: toNum(p.revenue, 2), cost: toNum(p.cost, 2), margin: toNum(p.margin, 2), marginPerHead: toNum(p.marginPerHead, 2) });
  return {
    lot: { id: m.lot.id, name: m.lot.name, category: m.lot.category },
    curve: s.curve.map(point),
    best: point(s.best),
    today: point(s.today),
    sensitivity: {
      priceMinus: { price: toNum(s.sensitivity.priceMinus.price, 4), best: point(s.sensitivity.priceMinus.best) },
      pricePlus: { price: toNum(s.sensitivity.pricePlus.price, 4), best: point(s.sensitivity.pricePlus.best) },
    },
    assumptions: {
      gdpPerDay: toNum(s.assumptions.gdpPerDay, 3),
      gdpSource: params.gdpPerDay ? "indicada por el usuario" : proj.source,
      dailyCostPerHead: toNum(s.assumptions.dailyCostPerHead, 4),
      dailyCostSource: params.dailyCostPerHead ? "indicado por el usuario" : "promedio de gastos del lote en los últimos 90 días",
      pricePerKg: toNum(s.assumptions.pricePerKg, 4),
      priceSource: params.pricePerKg ? "indicado por el usuario" : ref ? `referencia ${ref.source} del ${ref.date}` : "-",
      accumulatedCost: toNum(s.assumptions.accumulatedCost),
      headCount: s.assumptions.headCount,
      currentWeight: toNum(s.assumptions.currentWeight, 1),
      horizonDays: s.assumptions.horizonDays,
      commissionPct: toNum(s.assumptions.commissionPct, 2),
      startDate: metrics.asOf,
    },
  };
}

export type PurchaseSimulationParams = {
  category: string;
  entryWeight: string | number;
  purchasePrice: string | number;
  purchasePriceMode?: "kg" | "cabeza";
  expectedGdp?: string | number | null;
  dailyCostPerHead?: string | number | null;
  salePricePerKg?: string | number | null;
  targetWeight?: string | number | null;
  horizonDays?: number;
  extraCostsPerHead?: string | number | null;
  headCount?: number;
};

export function purchaseSimulation(ctx: FarmCtx, params: PurchaseSimulationParams) {
  assertCan(ctx.role, "read_money");
  const metrics = loadFarmMetrics(ctx);
  const prices = latestPrices(ctx);
  const category = parseCategory(params.category);
  const saleCategory: Category = category === "ternero" ? "novillo" : category === "ternera" ? "vaquillona" : category;
  const ref = priceFor(prices, saleCategory);
  const salePrice = params.salePricePerKg ? D(params.salePricePerKg) : ref?.price;
  if (!salePrice || salePrice.lte(0)) throw badRequest("Indicá un precio de venta esperado o cargá precios de referencia.");
  const active = [...metrics.lots.values()].filter((l) => l.lot.status === "activo" && l.headCount > 0);
  const avgGdp = metrics.totals.avgGdp ?? ZERO;
  const avgDaily = active.length ? active.reduce((s, l) => s.plus(l.dailyCostPerHead), ZERO).div(active.length) : ZERO;
  const gdp = params.expectedGdp ? D(params.expectedGdp) : avgGdp.gt(0) ? avgGdp : D("0.7");
  const daily = params.dailyCostPerHead ? D(params.dailyCostPerHead) : avgDaily;
  const entry = D(params.entryWeight);
  if (!entry.isFinite() || entry.lte(0)) throw badRequest("Ingresá un peso de ingreso válido.");
  const target = params.targetWeight ? D(params.targetWeight) : D(WEIGHT_RANGES[saleCategory][1]).times("0.8");
  const input: PurchaseSimulationInput = {
    startDate: metrics.asOf,
    entryWeight: entry,
    purchasePrice: params.purchasePrice,
    purchasePriceMode: params.purchasePriceMode === "cabeza" ? "cabeza" : "kg",
    expectedGdp: gdp,
    dailyCostPerHead: daily,
    salePricePerKg: salePrice,
    targetWeight: target,
    horizonDays: Math.max(1, Math.min(730, Number(params.horizonDays) || 365)),
    extraCostsPerHead: params.extraCostsPerHead ?? 0,
  };
  const p = simulatePurchase(input);
  const heads = Math.max(1, Math.floor(Number(params.headCount) || 1));
  return {
    category,
    saleCategory,
    categoryLabel: CATEGORY_LABELS[category],
    headCount: heads,
    purchaseCostPerHead: toNum(p.purchaseCostPerHead),
    daysToTarget: p.daysToTarget,
    suggestedSaleDays: p.suggestedSaleDays,
    suggestedSaleDate: p.suggestedSaleDate,
    saleWeight: toNum(p.saleWeight, 1),
    kgProduced: toNum(p.kgProduced, 1),
    revenuePerHead: toNum(p.revenuePerHead),
    feedingCostPerHead: toNum(p.feedingCostPerHead),
    totalCostPerHead: toNum(p.totalCostPerHead),
    marginPerHead: toNum(p.marginPerHead),
    marginTotal: toNum(p.marginPerHead.times(heads)),
    marginPerKgProduced: num(p.marginPerKgProduced, 4),
    costPerKgProduced: num(p.costPerKgProduced, 4),
    breakevenSalePricePerKg: toNum(p.breakevenSalePricePerKg, 4),
    breakevenDays: p.breakevenDays,
    dailyMarginalGain: toNum(p.dailyMarginalGain, 4),
    assumptions: {
      ...p.assumptions,
      gdpSource: params.expectedGdp ? "indicada por el usuario" : avgGdp.gt(0) ? "promedio ponderado de los lotes activos" : "valor por defecto 0,7 kg/día",
      dailyCostSource: params.dailyCostPerHead ? "indicado por el usuario" : "promedio de los lotes activos (últimos 90 días)",
      salePriceSource: params.salePricePerKg ? "indicado por el usuario" : ref ? `referencia ${ref.source} del ${ref.date} (${CATEGORY_LABELS[saleCategory]})` : "-",
      targetSource: params.targetWeight ? "indicado por el usuario" : `80% del máximo de la categoría ${CATEGORY_LABELS[saleCategory]}`,
    },
  };
}

export function compareLots(ctx: FarmCtx, metricsIn?: FarmMetrics) {
  assertCan(ctx.role, "read_money");
  const metrics = metricsIn || loadFarmMetrics(ctx);
  const prices = latestPrices(ctx);
  return [...metrics.lots.values()]
    .map((m) => {
      const price = priceFor(prices, m.lot.category);
      const marketValue = price && m.headCount ? m.totalWeight.times(price.price) : null;
      const closing = m.lot.closingResult as Record<string, string | number> | null;
      const closedKg = closing ? D(closing.kgProduced) : null;
      const closedExpenses = closing ? D(closing.directExpenses).plus(D(closing.allocatedExpenses)).plus(D(closing.deathLoss)) : null;
      return {
        lotId: m.lot.id,
        name: m.lot.name,
        category: m.lot.category,
        status: m.lot.status,
        headCount: m.headCount,
        avgWeight: num(m.avgWeight, 1),
        gdp: num(m.gdp, 3),
        trendGdp: num(m.trendGdp, 3),
        kgProduced: num(m.kgProduced, 1),
        costPerKgProduced: closing && closedKg?.gt(0) ? num(closedExpenses!.div(closedKg), 4) : num(m.costPerKgProduced, 4),
        fullCostPerKgProduced: closing && closedKg?.gt(0) ? num(D(closing.soldCost).plus(D(closing.deathLoss)).div(closedKg), 4) : num(m.fullCostPerKgProduced, 4),
        costPerHead: closing && m.soldHeads ? num(D(closing.soldCost).div(m.soldHeads)) : num(m.costPerHead),
        currentCost: num(m.currentCost),
        marketValue: num(marketValue),
        projectedMargin: marketValue ? num(marketValue.minus(m.currentCost)) : null,
        realizedResult: closing ? Number(closing.result) : m.soldHeads ? num(m.realizedResult) : null,
        pricePerKg: price ? toNum(price.price, 4) : null,
        marginPerKg: marketValue && m.totalWeight.gt(0) ? num(div(marketValue.minus(m.currentCost), m.totalWeight), 4) : null,
      };
    })
    .sort((a, b) => (a.status === b.status ? b.headCount - a.headCount : a.status === "activo" ? -1 : 1));
}

// Motor de métricas del campo (port de apps/api/src/services/metrics.ts).
// Deriva composición de lotes, GDP, kilos producidos, costos (compra +
// directos + prorrateo) y resultados. El costo "sigue al animal".

import { D, Decimal, ZERO, div, sum } from "@rodeo/shared";
import { addDays, daysBetween } from "@rodeo/shared";
import { animalGdp, lotGdp, type AnimalGdp, type WeightPoint } from "@rodeo/shared";
import { allocateGlobal, headDays as headDaysIn, type AllocationMethod } from "@rodeo/shared";
import { db } from "../db";
import type { FarmCtx } from "../core";
import type { AnimalRow, LotRow, MembershipRow, WeighingRow } from "../schema";

export type Membership = MembershipRow;
export type WeighingLite = WeighingRow;

export type LotAllocation = { lotId: string; expenseId: string; date: string; amount: Decimal; kind: "direct" | "allocated"; category: string };

export type AnimalMetrics = {
  animal: AnimalRow;
  lastWeight: Decimal | null;
  lastDate: string | null;
  lastWeighingId: string | null;
  gdp: AnimalGdp;
  purchaseCost: Decimal;
  expenseShare: Decimal;
  accumulatedCost: Decimal;
  daysInCurrentLot: number | null;
  withdrawalUntil: string | null;
  weighings: WeighingLite[];
};

export type LotHistoryPoint = { date: string; avgWeight: Decimal; count: number; sessionId: string | null };

export type LotMetrics = {
  lot: LotRow;
  headCount: number;
  avgWeight: Decimal | null;
  totalWeight: Decimal;
  lastWeighingDate: string | null;
  gdp: Decimal | null;
  trendGdp: Decimal | null;
  kgProduced: Decimal;
  avgDaysInLot: number | null;
  purchaseCost: Decimal;
  expenseCost: Decimal;
  currentCost: Decimal;
  deathLoss: Decimal;
  unassignedExpenses: Decimal;
  totalCost: Decimal;
  costPerHead: Decimal;
  costPerKgProduced: Decimal | null;
  fullCostPerKgProduced: Decimal | null;
  dailyCostPerHead: Decimal;
  directExpenses: Decimal;
  allocatedExpenses: Decimal;
  revenue: Decimal;
  soldCost: Decimal;
  realizedResult: Decimal;
  soldHeads: number;
  deadHeads: number;
  history: LotHistoryPoint[];
  animalIds: string[];
  categoryCounts: Record<string, number>;
};

export type FarmMetrics = {
  asOf: string;
  lots: Map<string, LotMetrics>;
  animals: Map<string, AnimalMetrics>;
  allocations: LotAllocation[];
  membershipsByLot: Map<string, Membership[]>;
  membershipsByAnimal: Map<string, Membership[]>;
  totals: { activeHeads: number; totalWeight: Decimal; avgGdp: Decimal | null; expensesAllTime: Decimal };
};

const monthRange = (date: string) => {
  const start = date.slice(0, 7) + "-01";
  const [y, m] = start.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end: next };
};

function presentAt(memberships: Membership[], date: string) {
  return memberships.filter((m) => m.fromDate <= date && (m.toDate === null || m.toDate > date));
}

export function loadFarmMetrics(ctx: FarmCtx, options: { asOf?: string } = {}): FarmMetrics {
  const farmId = ctx.farm.id;
  const asOf = options.asOf || ctx.today;
  const lotRows = db.lots.filter((l) => l.farmId === farmId);
  const animalRows = db.animals.filter((a) => a.farmId === farmId);
  const animalIdSet = new Set(animalRows.map((a) => a.id));
  const memberships = db.lotMemberships.filter((m) => m.farmId === farmId);
  const weighingRows = db.weighings.filter((w) => w.farmId === farmId).sort((a, b) => a.weighedAt.localeCompare(b.weighedAt));
  const avgRows = db.lotAverageWeighings.filter((r) => r.farmId === farmId);
  const expenseRows = db.expenses.filter((e) => e.farmId === farmId);
  const allocationRows = db.expenseAllocations.filter((a) => a.farmId === farmId);
  const saleRows = db.movements.filter((m) => m.farmId === farmId && (m.type === "venta" || m.type === "muerte"));
  const withdrawals = db.healthEventAnimals.filter((h) => animalIdSet.has(h.animalId)).map((h) => ({ animalId: h.animalId, until: h.withdrawalUntil }));

  const membershipsByLot = new Map<string, Membership[]>();
  const membershipsByAnimal = new Map<string, Membership[]>();
  for (const m of memberships) {
    if (m.fromDate > asOf) continue;
    membershipsByLot.set(m.lotId, [...(membershipsByLot.get(m.lotId) || []), m]);
    membershipsByAnimal.set(m.animalId, [...(membershipsByAnimal.get(m.animalId) || []), m]);
  }
  const weighingsByAnimal = new Map<string, WeighingLite[]>();
  const weighingsByLot = new Map<string, WeighingLite[]>();
  for (const w of weighingRows) {
    if (w.date > asOf) continue;
    weighingsByAnimal.set(w.animalId, [...(weighingsByAnimal.get(w.animalId) || []), w]);
    if (w.lotId) weighingsByLot.set(w.lotId, [...(weighingsByLot.get(w.lotId) || []), w]);
  }

  // ---- Prorrateo de gastos por lote ----
  const method = (ctx.farm.allocationMethod as AllocationMethod) || "head_days";
  const allocations: LotAllocation[] = [];
  const allocationsByExpense = new Map<string, typeof allocationRows>();
  for (const a of allocationRows) allocationsByExpense.set(a.expenseId, [...(allocationsByExpense.get(a.expenseId) || []), a]);
  const headDaysOf = (lotId: string, from: string, to: string) => (membershipsByLot.get(lotId) || []).reduce((acc, m) => acc + headDaysIn(m.fromDate, m.toDate, from, to), 0);
  for (const e of expenseRows) {
    if (e.date > asOf) continue;
    const allocs = allocationsByExpense.get(e.id) || [];
    const total = D(e.total);
    for (const a of allocs) {
      const amount = total.times(D(a.percentage)).div(100);
      if (a.lotId) {
        allocations.push({ lotId: a.lotId, expenseId: e.id, date: e.date, amount, kind: "direct", category: e.category });
        continue;
      }
      const { start, end } = monthRange(e.date);
      let shares = lotRows.map((l) => ({
        lotId: l.id,
        headDays: method === "head_days" ? headDaysOf(l.id, start, end) : presentAt(membershipsByLot.get(l.id) || [], e.date).length,
        heads: presentAt(membershipsByLot.get(l.id) || [], e.date).length,
      }));
      if (!shares.some((s) => D(s.headDays).gt(0))) shares = shares.map((s) => ({ ...s, headDays: s.heads }));
      const parts = allocateGlobal(amount, shares, "head_days");
      for (const [lotId, part] of parts) {
        if (part.gt(0)) allocations.push({ lotId, expenseId: e.id, date: e.date, amount: part, kind: "allocated", category: e.category });
      }
    }
  }

  // ---- Costo por animal ----
  const purchaseCostOf = new Map<string, Decimal>();
  const expenseShareOf = new Map<string, Decimal>();
  const unassignedByLot = new Map<string, Decimal>();
  for (const a of animalRows) {
    purchaseCostOf.set(a.id, D(a.purchaseCost));
    expenseShareOf.set(a.id, ZERO);
  }
  for (const al of allocations) {
    const present = presentAt(membershipsByLot.get(al.lotId) || [], al.date);
    if (!present.length) {
      unassignedByLot.set(al.lotId, (unassignedByLot.get(al.lotId) || ZERO).plus(al.amount));
      continue;
    }
    const share = al.amount.div(present.length);
    for (const m of present) expenseShareOf.set(m.animalId, (expenseShareOf.get(m.animalId) || ZERO).plus(share));
  }

  // ---- Métricas por animal ----
  const withdrawalByAnimal = new Map<string, string>();
  for (const w of withdrawals) {
    if (!w.until || w.until < asOf) continue;
    const prev = withdrawalByAnimal.get(w.animalId);
    if (!prev || w.until > prev) withdrawalByAnimal.set(w.animalId, w.until);
  }
  const animalMetrics = new Map<string, AnimalMetrics>();
  for (const a of animalRows) {
    const ws = weighingsByAnimal.get(a.id) || [];
    const last = ws[ws.length - 1];
    const current = (membershipsByAnimal.get(a.id) || []).find((m) => m.toDate === null);
    animalMetrics.set(a.id, {
      animal: a,
      lastWeight: last ? D(last.weight) : null,
      lastDate: last ? last.date : null,
      lastWeighingId: last ? last.id : null,
      gdp: animalGdp(ws.map((w) => ({ date: w.date, weight: w.weight }))),
      purchaseCost: purchaseCostOf.get(a.id) || ZERO,
      expenseShare: expenseShareOf.get(a.id) || ZERO,
      accumulatedCost: (purchaseCostOf.get(a.id) || ZERO).plus(expenseShareOf.get(a.id) || ZERO),
      daysInCurrentLot: current ? daysBetween(current.fromDate, asOf) : null,
      withdrawalUntil: withdrawalByAnimal.get(a.id) || null,
      weighings: ws,
    });
  }

  // ---- Métricas por lote ----
  const lotMetrics = new Map<string, LotMetrics>();
  const recentFrom = addDays(asOf, -90);
  for (const lot of lotRows) {
    const lotMemberRows = membershipsByLot.get(lot.id) || [];
    const currentIds = lotMemberRows.filter((m) => m.toDate === null).map((m) => m.animalId);
    const currentAnimals = currentIds.map((id) => animalMetrics.get(id)!).filter((m) => m && m.animal.status === "activo");
    const lotWeighings = weighingsByLot.get(lot.id) || [];

    const seriesByAnimal = new Map<string, WeightPoint[]>();
    for (const w of lotWeighings) seriesByAnimal.set(w.animalId, [...(seriesByAnimal.get(w.animalId) || []), { date: w.date, weight: w.weight }]);
    const currentSet = new Set(currentAnimals.map((m) => m.animal.id));
    const currentGdps: AnimalGdp[] = [];
    let departedKg = ZERO;
    for (const [animalId, pts] of seriesByAnimal) {
      const g = animalGdp(pts);
      if (currentSet.has(animalId)) currentGdps.push(g);
      else departedKg = departedKg.plus(g.kgGained);
    }
    const lg = lotGdp(currentGdps);

    const weightsNow = currentAnimals.map((m) => m.lastWeight).filter((w): w is Decimal => w !== null);
    const lotAvgs = avgRows.filter((r) => r.lotId === lot.id && r.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
    const lastAvg = lotAvgs[lotAvgs.length - 1];
    let avgWeight: Decimal | null = weightsNow.length ? sum(weightsNow).div(weightsNow.length) : null;
    if (!avgWeight && lastAvg) avgWeight = div(lastAvg.totalWeight, lastAvg.headCount);
    const totalWeight = avgWeight ? avgWeight.times(currentAnimals.length) : ZERO;
    const lastWeighingDate = [...lotWeighings.map((w) => w.date), ...lotAvgs.map((r) => r.date)].sort().pop() || null;

    const dates = [...new Set(lotWeighings.map((w) => w.date))].sort();
    const history: LotHistoryPoint[] = dates.map((date) => {
      const present = new Set(presentAt(lotMemberRows, date).map((m) => m.animalId));
      const weights: Decimal[] = [];
      for (const animalId of present) {
        const last = (weighingsByAnimal.get(animalId) || []).filter((w) => w.date <= date && w.lotId === lot.id).pop();
        if (last) weights.push(D(last.weight));
      }
      const sessionId = lotWeighings.find((w) => w.date === date)?.sessionId ?? null;
      return { sessionId, date, avgWeight: weights.length ? sum(weights).div(weights.length) : ZERO, count: weights.length };
    });
    for (const r of lotAvgs) history.push({ sessionId: r.sessionId, date: r.date, avgWeight: div(r.totalWeight, r.headCount), count: r.headCount });
    history.sort((a, b) => a.date.localeCompare(b.date));

    const purchaseCost = sum(currentAnimals.map((m) => m.purchaseCost));
    const unassigned = unassignedByLot.get(lot.id) || ZERO;
    const expenseCost = sum(currentAnimals.map((m) => m.expenseShare)).plus(unassigned);
    const lastLotOf = (animalId: string) => {
      const ms = membershipsByAnimal.get(animalId) || [];
      return ms.length ? ms.reduce((a, b) => (b.fromDate >= a.fromDate ? b : a)).lotId : null;
    };
    const dead = animalRows.filter((a) => a.status === "muerto" && lastLotOf(a.id) === lot.id);
    const deathLoss = sum(dead.map((a) => animalMetrics.get(a.id)!.accumulatedCost));
    const currentCost = purchaseCost.plus(expenseCost);
    const totalCost = currentCost.plus(deathLoss);
    const kgProduced = lg.kgProduced.plus(departedKg);
    const lotAllocs = allocations.filter((a) => a.lotId === lot.id);
    const directExpenses = sum(lotAllocs.filter((a) => a.kind === "direct").map((a) => a.amount));
    const allocatedExpenses = sum(lotAllocs.filter((a) => a.kind === "allocated").map((a) => a.amount));
    const recentExpenses = sum(lotAllocs.filter((a) => a.date >= recentFrom).map((a) => a.amount));
    const recentHeadDays = headDaysOf(lot.id, recentFrom, asOf);
    const allHeadDays = headDaysOf(lot.id, "1970-01-01", asOf);
    const dailyCostPerHead = recentHeadDays > 0 ? recentExpenses.div(recentHeadDays) : div(directExpenses.plus(allocatedExpenses), allHeadDays);

    const sales = saleRows.filter((m) => m.type === "venta" && m.fromLotId === lot.id && m.date <= asOf);
    const revenue = sum(sales.map((s) => s.netAmount));
    const soldCost = sum(sales.map((s) => s.allocatedCost));
    const realizedResult = sum(sales.map((s) => s.result));
    const soldHeads = sales.reduce((n, s) => n + s.headCount, 0);

    const categoryCounts: Record<string, number> = {};
    for (const m of currentAnimals) categoryCounts[m.animal.category] = (categoryCounts[m.animal.category] || 0) + 1;
    const daysList = currentAnimals.map((m) => m.daysInCurrentLot).filter((d): d is number => d !== null);

    lotMetrics.set(lot.id, {
      lot,
      headCount: currentAnimals.length,
      avgWeight,
      totalWeight,
      lastWeighingDate,
      gdp: lg.gdp,
      trendGdp: lg.trendGdp,
      kgProduced,
      avgDaysInLot: daysList.length ? Math.round(daysList.reduce((a, b) => a + b, 0) / daysList.length) : null,
      purchaseCost,
      expenseCost,
      currentCost,
      deathLoss,
      unassignedExpenses: unassigned,
      totalCost,
      costPerHead: div(currentCost, currentAnimals.length),
      costPerKgProduced: kgProduced.gt(0) ? expenseCost.plus(deathLoss).div(kgProduced) : null,
      fullCostPerKgProduced: kgProduced.gt(0) ? totalCost.div(kgProduced) : null,
      dailyCostPerHead,
      directExpenses,
      allocatedExpenses,
      revenue,
      soldCost,
      realizedResult,
      soldHeads,
      deadHeads: dead.length,
      history,
      animalIds: currentAnimals.map((m) => m.animal.id),
      categoryCounts,
    });
  }

  const activeLots = [...lotMetrics.values()].filter((l) => l.lot.status === "activo");
  const activeHeads = activeLots.reduce((n, l) => n + l.headCount, 0);
  let gdpWeighted = ZERO;
  let gdpHeads = 0;
  for (const l of activeLots) {
    if (l.gdp && l.headCount) {
      gdpWeighted = gdpWeighted.plus(l.gdp.times(l.headCount));
      gdpHeads += l.headCount;
    }
  }
  return {
    asOf,
    lots: lotMetrics,
    animals: animalMetrics,
    allocations,
    membershipsByLot,
    membershipsByAnimal,
    totals: {
      activeHeads,
      totalWeight: sum(activeLots.map((l) => l.totalWeight)),
      avgGdp: gdpHeads ? gdpWeighted.div(gdpHeads) : null,
      expensesAllTime: sum(expenseRows.filter((e) => e.date <= asOf).map((e) => e.total)),
    },
  };
}

// Vista completa del campo activo para la interfaz (port de apps/api/src/services/snapshot.ts).

import { toNum, type Decimal } from "@rodeo/shared";
import { CATEGORY_LABELS, MOVEMENT_LABELS, DISEASE_ACTIVE_DAYS, type Category, type MovementType } from "@rodeo/shared";
import { daysBetween } from "@rodeo/shared";
import type { FarmSnapshot, LotView, AnimalView } from "@rodeo/shared";
import { db } from "../db";
import { can, type FarmCtx } from "../core";
import { loadFarmMetrics } from "./metrics";
import { lotProjection } from "./analytics";
import { latestPrices, priceFor } from "./prices";
import { listSessions } from "./weighings";
import { listExpenses } from "./expenses";
import { listHealthEvents, listReminders } from "./health";
import { listMovements } from "./movements";
import { computeAlerts } from "./alerts";
import { pendingImports } from "./imports";
import { listOwners, reproStates } from "./owners";

const num = (d: Decimal | null | undefined, dp = 2) => (d === null || d === undefined ? null : toNum(d, dp));

export function farmSnapshot(ctx: FarmCtx): FarmSnapshot {
  const money = can(ctx.role, "read_money");
  const metrics = loadFarmMetrics(ctx);
  const prices = latestPrices(ctx);
  const sessions = listSessions(ctx);
  const expenses = listExpenses(ctx);
  const health = listHealthEvents(ctx);
  const movements = listMovements(ctx);
  const reminders = listReminders(ctx);
  const pending = pendingImports(ctx);
  const paddockRows = db.paddocks.filter((p) => p.farmId === ctx.farm.id).sort((a, b) => a.name.localeCompare(b.name));
  const ownerRows = listOwners(ctx);
  const repro = reproStates(ctx, metrics.asOf);
  const alerts = computeAlerts(ctx, metrics);

  const paddockName = new Map(paddockRows.map((p) => [p.id, p.name]));
  const ownerById = new Map(ownerRows.map((o) => [o.id, o]));
  const eidById = new Map([...metrics.animals.values()].map((m) => [m.animal.id, m.animal.eid]));
  const diseasesByAnimal = new Map<string, { product: string; date: string }[]>();
  for (const h of health) {
    if (h.type !== "enfermedad" || daysBetween(h.date, metrics.asOf) > DISEASE_ACTIVE_DAYS) continue;
    for (const id of h.animalIds) {
      const list = diseasesByAnimal.get(id) || [];
      if (!list.some((d) => d.product === h.product)) list.push({ product: h.product, date: h.date });
      diseasesByAnimal.set(id, list);
    }
  }

  const lots: LotView[] = [...metrics.lots.values()]
    .map((m) => {
      const price = priceFor(prices, m.lot.category);
      const marketValue = price && m.headCount ? m.totalWeight.times(price.price) : null;
      return {
        id: m.lot.id,
        name: m.lot.name,
        category: m.lot.category,
        categoryLabel: CATEGORY_LABELS[m.lot.category as Category] || m.lot.category,
        status: m.lot.status as "activo" | "cerrado",
        color: m.lot.color,
        target: m.lot.targetWeight ? toNum(m.lot.targetWeight, 1) : null,
        startDate: m.lot.startDate,
        paddockId: m.lot.paddockId,
        paddockName: m.lot.paddockId ? paddockName.get(m.lot.paddockId) || null : null,
        notes: m.lot.notes,
        count: m.headCount,
        weight: num(m.avgWeight, 1),
        totalWeight: toNum(m.totalWeight, 1),
        gain: num(m.gdp, 3),
        trendGain: num(m.trendGdp, 3),
        kgProduced: toNum(m.kgProduced, 1),
        lastWeighingDate: m.lastWeighingDate,
        avgDaysInLot: m.avgDaysInLot,
        history: m.history.map((h) => ({ date: h.date, avgWeight: toNum(h.avgWeight, 1), count: h.count })),
        categoryCounts: m.categoryCounts,
        soldHeads: m.soldHeads,
        deadHeads: m.deadHeads,
        closedAt: m.lot.closedAt,
        closingResult: money ? m.lot.closingResult : null,
        projection: lotProjection(m, metrics.asOf),
        costs: money
          ? {
              purchase: toNum(m.purchaseCost),
              expenses: toNum(m.expenseCost),
              direct: toNum(m.directExpenses),
              allocated: toNum(m.allocatedExpenses),
              current: toNum(m.currentCost),
              deathLoss: toNum(m.deathLoss),
              total: toNum(m.totalCost),
              perHead: toNum(m.costPerHead),
              perKgProduced: num(m.costPerKgProduced, 4),
              fullPerKgProduced: num(m.fullCostPerKgProduced, 4),
              perKgLive: m.totalWeight.gt(0) ? toNum(m.currentCost.div(m.totalWeight), 4) : null,
              dailyPerHead: toNum(m.dailyCostPerHead, 4),
            }
          : null,
        marketPrice: money && price ? toNum(price.price, 4) : null,
        marketValue: money ? num(marketValue) : null,
        estimatedMargin: money && marketValue ? toNum(marketValue.minus(m.currentCost)) : null,
        revenue: money ? toNum(m.revenue) : null,
        realizedResult: money ? toNum(m.realizedResult) : null,
      };
    })
    .sort((a, b) => (a.status === b.status ? a.startDate.localeCompare(b.startDate) : a.status === "activo" ? -1 : 1));

  const animals: AnimalView[] = [...metrics.animals.values()].map((m) => {
    const st = repro.get(m.animal.id);
    const owner = m.animal.ownerId ? ownerById.get(m.animal.ownerId) : undefined;
    return {
      id: m.animal.id,
      eid: m.animal.eid,
      visual: m.animal.visualTag || m.animal.eid.slice(-4),
      sex: m.animal.sex,
      category: m.animal.category,
      breed: m.animal.breed,
      birthDate: m.animal.birthDateEstimated,
      origin: m.animal.origin,
      status: m.animal.status,
      lot: m.animal.currentLotId,
      weight: num(m.lastWeight, 1),
      lastDate: m.lastDate,
      gain: num(m.gdp.periodGdp, 3),
      daysInLot: m.daysInCurrentLot,
      withdrawalUntil: m.withdrawalUntil,
      purchaseDate: m.animal.purchaseDate,
      notes: m.animal.notes,
      cost: money ? toNum(m.accumulatedCost) : null,
      purchaseCost: money && m.animal.purchaseCost ? toNum(m.animal.purchaseCost) : null,
      owner: owner ? { id: owner.id, name: owner.name, dicose: owner.dicose } : null,
      pledge: m.animal.pledgedBank ? { bank: m.animal.pledgedBank, ref: m.animal.pledgedRef, since: m.animal.pledgedSince } : null,
      repro: st ? { ...st, bullEid: st.bullId ? eidById.get(st.bullId) || null : null } : null,
      diseases: diseasesByAnimal.get(m.animal.id) || [],
    };
  });
  const activeAnimals = animals.filter((a) => a.status === "activo");

  return {
    farm: {
      id: ctx.farm.id,
      name: ctx.farm.name,
      location: ctx.farm.location,
      hectares: toNum(ctx.farm.hectares, 2),
      currency: ctx.farm.currency,
      weightUnit: ctx.farm.weightUnit,
      timezone: ctx.farm.timezone,
      allocationMethod: ctx.farm.allocationMethod,
      withdrawalPolicy: ctx.farm.withdrawalPolicy,
      alertConfig: ctx.farm.alertConfig,
      createdAt: ctx.farm.createdAt,
    },
    role: ctx.role,
    today: metrics.asOf,
    lots,
    animals,
    sessions: sessions.map((s) => ({ id: s.id, date: s.date, name: s.name, origin: s.origin, count: s.count, avgWeight: s.avgWeight, lotIds: s.lotIds, fileName: s.fileName, notes: s.notes, createdAt: s.createdAt })),
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      subcategory: e.subcategory,
      description: e.description,
      supplier: e.supplier,
      quantity: e.quantity ? toNum(e.quantity, 3) : null,
      unit: e.unit,
      unitPrice: e.unitPrice ? toNum(e.unitPrice, 4) : null,
      total: e.total ? toNum(e.total) : null,
      currency: e.currency,
      receiptName: e.receiptName,
      receiptKey: e.receiptKey,
      notes: e.notes,
      allocations: e.allocations,
      lot: e.allocations.length === 1 && e.allocations[0].lotId ? e.allocations[0].lotId : e.allocations.some((a) => a.lotId) ? "multi" : "global",
    })),
    health: health.map((h) => ({ id: h.id, date: h.date, type: h.type, product: h.product, dose: h.dose, lotId: h.lotId, lotName: h.lotName, scope: h.scope, withdrawalDays: h.withdrawalDays, withdrawalUntil: h.withdrawalUntil, withdrawalActive: h.withdrawalActive, animalCount: h.animalCount, animalIds: h.animalIds, expenseId: h.expenseId, notes: h.notes })),
    movements: movements.map((m) => ({
      id: m.id,
      date: m.date,
      type: m.type,
      typeLabel: MOVEMENT_LABELS[m.type as MovementType] || m.type,
      counterparty: m.counterparty,
      headCount: m.headCount,
      totalWeight: m.totalWeight ? toNum(m.totalWeight, 1) : null,
      priceMode: m.priceMode,
      unitPrice: m.unitPrice ? toNum(m.unitPrice, 4) : null,
      currency: m.currency,
      commission: m.commission ? toNum(m.commission) : null,
      freight: m.freight ? toNum(m.freight) : null,
      grossAmount: m.grossAmount ? toNum(m.grossAmount) : null,
      netAmount: m.netAmount ? toNum(m.netAmount) : null,
      allocatedCost: m.allocatedCost ? toNum(m.allocatedCost) : null,
      result: m.result ? toNum(m.result) : null,
      documentRef: m.documentRef,
      notes: m.notes,
      cause: m.cause,
      fromLotId: m.fromLotId,
      toLotId: m.toLotId,
      toFarmId: m.toFarmId,
      lot: m.fromLotId || m.toLotId || "global",
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    reminders: reminders.map((r) => ({ id: r.id, title: r.title, dueDate: r.dueDate, lotId: r.lotId, lotName: r.lotName, notes: r.notes, doneAt: r.doneAt })),
    prices: money ? Object.fromEntries(Object.entries(prices).map(([c, p]) => [c, { category: c, pricePerKg: toNum(p!.pricePerKg, 4), date: p!.date, source: p!.source, currency: p!.currency }])) : {},
    alerts,
    pendingImports: pending.map((p) => ({ id: p.id, fileName: p.fileName, createdAt: p.createdAt })),
    paddocks: paddockRows.map((p) => ({ id: p.id, name: p.name, hectares: toNum(p.hectares, 2) })),
    owners: ownerRows.map((o) => ({ id: o.id, name: o.name, dicose: o.dicose, notes: o.notes, activeAnimals: o.activeAnimals, pledgedAnimals: o.pledgedAnimals })),
    totals: {
      activeHeads: metrics.totals.activeHeads,
      totalWeight: toNum(metrics.totals.totalWeight, 1),
      avgGdp: num(metrics.totals.avgGdp, 3),
      expensesAllTime: money ? toNum(metrics.totals.expensesAllTime) : null,
      activeLots: lots.filter((l) => l.status === "activo").length,
      pregnant: activeAnimals.filter((a) => a.repro?.pregnant).length,
      inService: activeAnimals.filter((a) => a.repro?.inService).length,
      pledged: activeAnimals.filter((a) => a.pledge).length,
      sick: activeAnimals.filter((a) => a.diseases.length).length,
    },
  };
}

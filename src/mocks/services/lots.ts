// Lotes y potreros (port de apps/api/src/services/lots.ts y parte de farms.ts).

import { toDb, toNum, money2 } from "@rodeo/shared";
import { CATEGORY_COLORS, parseCategory } from "@rodeo/shared";
import { isIsoDate } from "@rodeo/shared";
import { db, uuid, nowIso, deleteLotCascade } from "../db";
import { assertCan, badRequest, notFound, type FarmCtx } from "../core";
import { loadFarmMetrics } from "./metrics";
import { getLotOrThrow } from "./animals";
import type { LotRow } from "../schema";

export type LotInput = { name: string; category?: string | null; paddockId?: string | null; targetWeight?: number | string | null; notes?: string | null; color?: string | null; startDate?: string | null };

function assertPaddock(ctx: FarmCtx, paddockId: string) {
  if (!db.paddocks.some((p) => p.id === paddockId && p.farmId === ctx.farm.id)) throw notFound("El potrero no existe en este campo.");
}

export function createLot(ctx: FarmCtx, input: LotInput) {
  assertCan(ctx.role, "write_operational");
  const name = input.name?.trim();
  if (!name) throw badRequest("Ingresá el nombre del lote.");
  const category = parseCategory(input.category);
  if (input.paddockId) assertPaddock(ctx, input.paddockId);
  const now = nowIso();
  const row: LotRow = {
    id: uuid(),
    farmId: ctx.farm.id,
    name,
    category,
    paddockId: input.paddockId || null,
    status: "activo",
    targetWeight: input.targetWeight ? toDb(input.targetWeight, 1) : null,
    notes: input.notes?.trim() || null,
    color: input.color && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : CATEGORY_COLORS[category],
    startDate: input.startDate && isIsoDate(input.startDate) ? input.startDate : ctx.today,
    closedAt: null,
    closingResult: null,
    createdAt: now,
    updatedAt: now,
  };
  db.lots.push(row);
  return row;
}

export function updateLot(ctx: FarmCtx, id: string, input: Partial<LotInput>) {
  assertCan(ctx.role, "write_operational");
  const lot = getLotOrThrow(ctx, id, false);
  const patch: Partial<LotRow> = { updatedAt: nowIso() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw badRequest("El nombre no puede quedar vacío.");
    patch.name = input.name.trim();
  }
  if (input.category !== undefined) patch.category = parseCategory(input.category);
  if (input.paddockId !== undefined) {
    if (input.paddockId) assertPaddock(ctx, input.paddockId);
    patch.paddockId = input.paddockId || null;
  }
  if (input.targetWeight !== undefined) patch.targetWeight = input.targetWeight ? toDb(input.targetWeight, 1) : null;
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.color && /^#[0-9a-f]{6}$/i.test(input.color)) patch.color = input.color;
  if (input.startDate && isIsoDate(input.startDate)) patch.startDate = input.startDate;
  Object.assign(lot, patch);
  return lot;
}

/** Cierra un lote sin animales activos y guarda su resultado final. */
export function closeLot(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "write_operational");
  const lot = getLotOrThrow(ctx, id, false);
  if (lot.status !== "activo") throw badRequest("El lote ya está cerrado.");
  const metrics = loadFarmMetrics(ctx);
  const m = metrics.lots.get(lot.id)!;
  if (m.headCount > 0) throw badRequest(`El lote todavía tiene ${m.headCount} animales activos. Vendelos o transferilos antes de cerrarlo.`);
  const result = m.revenue.minus(m.soldCost).minus(m.deathLoss).minus(m.unassignedExpenses);
  const closingResult = {
    revenue: money2(m.revenue),
    soldCost: money2(m.soldCost),
    deathLoss: money2(m.deathLoss),
    unassignedExpenses: money2(m.unassignedExpenses),
    result: money2(result),
    kgProduced: toNum(m.kgProduced, 1),
    soldHeads: m.soldHeads,
    deadHeads: m.deadHeads,
    directExpenses: money2(m.directExpenses),
    allocatedExpenses: money2(m.allocatedExpenses),
    closedOn: metrics.asOf,
  };
  Object.assign(lot, { status: "cerrado", closedAt: nowIso(), closingResult, updatedAt: nowIso() });
  return lot;
}

export function deleteLot(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "manage_farm");
  const lot = getLotOrThrow(ctx, id, false);
  if (db.lotMemberships.some((m) => m.lotId === lot.id)) throw badRequest("El lote tiene historial de animales; cerralo en lugar de eliminarlo.");
  deleteLotCascade(lot.id);
}

// ---------- Potreros ----------

export function createPaddock(ctx: FarmCtx, input: { name: string; hectares?: number | string }) {
  assertCan(ctx.role, "manage_farm");
  if (!input.name?.trim()) throw badRequest("Ingresá el nombre del potrero.");
  const row = { id: uuid(), farmId: ctx.farm.id, name: input.name.trim(), hectares: toDb(input.hectares || 0, 2), createdAt: nowIso() };
  db.paddocks.push(row);
  return row;
}

export function deletePaddock(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "manage_farm");
  db.paddocks = db.paddocks.filter((p) => !(p.id === id && p.farmId === ctx.farm.id));
  for (const l of db.lots) if (l.paddockId === id) l.paddockId = null;
}

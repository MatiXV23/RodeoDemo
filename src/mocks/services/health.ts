// Sanidad: eventos, retiros y recordatorios (port de apps/api/src/services/health.ts).

import { HEALTH_TYPES } from "@rodeo/shared";
import { addDays, isIsoDate } from "@rodeo/shared";
import { db, uuid, nowIso, deleteHealthEventCascade } from "../db";
import { assertCan, badRequest, notFound, type FarmCtx } from "../core";
import { getLotOrThrow } from "./animals";

export type HealthInput = {
  type: string;
  product: string;
  dose?: string | null;
  date?: string | null;
  lotId?: string | null;
  animalIds?: string[];
  withdrawalDays?: number | string | null;
  expenseId?: string | null;
  notes?: string | null;
  reminder?: { title?: string | null; dueDate: string; notes?: string | null } | null;
};

export function createHealthEvent(ctx: FarmCtx, input: HealthInput) {
  assertCan(ctx.role, "write_operational");
  if (!(HEALTH_TYPES as readonly string[]).includes(input.type)) throw badRequest("Tipo de evento sanitario no válido.");
  if (!input.product?.trim()) throw badRequest("Indicá el producto aplicado.");
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  const withdrawalDays = Math.max(0, Math.min(365, Math.floor(Number(input.withdrawalDays) || 0)));
  let targetIds: string[] = [];
  let lotId: string | null = null;
  let scope: "lote" | "animales" = "animales";
  if (input.animalIds?.length) {
    const set = new Set(input.animalIds);
    const rows = db.animals.filter((a) => a.farmId === ctx.farm.id && set.has(a.id));
    if (rows.length !== set.size) throw notFound("Alguno de los animales no existe en este campo.");
    targetIds = rows.map((r) => r.id);
    const lotIds = [...new Set(rows.map((r) => r.currentLotId).filter(Boolean))] as string[];
    lotId = input.lotId || (lotIds.length === 1 ? lotIds[0] : null);
  } else if (input.lotId) {
    const lot = getLotOrThrow(ctx, input.lotId);
    lotId = lot.id;
    scope = "lote";
    targetIds = db.animals.filter((a) => a.farmId === ctx.farm.id && a.currentLotId === lot.id && a.status === "activo").map((a) => a.id);
  } else throw badRequest("Indicá un lote o los animales tratados.");
  if (input.expenseId && !db.expenses.some((e) => e.id === input.expenseId && e.farmId === ctx.farm.id)) throw notFound("El gasto vinculado no existe.");
  const id = uuid();
  const withdrawalUntil = withdrawalDays > 0 ? addDays(date, withdrawalDays) : null;
  const product = input.product.trim();
  db.healthEvents.push({ id, farmId: ctx.farm.id, type: input.type, product, dose: input.dose?.trim() || null, date, lotId, scope, withdrawalDays, expenseId: input.expenseId || null, notes: input.notes?.trim() || null, createdBy: ctx.user.id, createdAt: nowIso() });
  db.healthEventAnimals.push(...targetIds.map((animalId) => ({ eventId: id, animalId, withdrawalUntil })));
  if (input.reminder?.dueDate && isIsoDate(input.reminder.dueDate)) {
    db.healthReminders.push({ id: uuid(), farmId: ctx.farm.id, title: input.reminder.title?.trim() || `Próxima dosis: ${product}`, dueDate: input.reminder.dueDate, lotId, eventId: id, notes: input.reminder.notes?.trim() || null, doneAt: null, createdBy: ctx.user.id, createdAt: nowIso() });
  }
  return { id, animals: targetIds.length, withdrawalUntil };
}

export function deleteHealthEvent(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "edit_movements", "Solo un administrador puede eliminar eventos sanitarios.");
  if (!db.healthEvents.some((h) => h.id === id && h.farmId === ctx.farm.id)) throw notFound("El evento no existe.");
  deleteHealthEventCascade(id);
}

export function listHealthEvents(ctx: FarmCtx) {
  const lotName = new Map(db.lots.map((l) => [l.id, l.name]));
  const rows = db.healthEvents.filter((h) => h.farmId === ctx.farm.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const ids = new Set(rows.map((r) => r.id));
  const byEvent = new Map<string, { count: number; until: string | null; animalIds: string[] }>();
  for (const c of db.healthEventAnimals) {
    if (!ids.has(c.eventId)) continue;
    const cur = byEvent.get(c.eventId) || { count: 0, until: c.withdrawalUntil, animalIds: [] };
    cur.count++;
    cur.animalIds.push(c.animalId);
    byEvent.set(c.eventId, cur);
  }
  return rows.map((e) => {
    const info = byEvent.get(e.id) || { count: 0, until: null, animalIds: [] };
    return { ...e, lotName: e.lotId ? lotName.get(e.lotId) || null : null, animalCount: info.count, animalIds: info.animalIds, withdrawalUntil: info.until, withdrawalActive: !!info.until && info.until >= ctx.today };
  });
}

/** Animales activos con retiro vigente a una fecha. */
export function activeWithdrawals(ctx: FarmCtx, date?: string) {
  const asOf = date && isIsoDate(date) ? date : ctx.today;
  const eventById = new Map(db.healthEvents.filter((h) => h.farmId === ctx.farm.id).map((h) => [h.id, h]));
  const animalById = new Map(db.animals.filter((a) => a.farmId === ctx.farm.id && a.status === "activo").map((a) => [a.id, a]));
  const map = new Map<string, { animalId: string; until: string | null; eventId: string; product: string; eid: string; lotId: string | null }>();
  for (const r of db.healthEventAnimals) {
    const e = eventById.get(r.eventId);
    const a = animalById.get(r.animalId);
    if (!e || !a || !r.withdrawalUntil || r.withdrawalUntil < asOf) continue;
    const prev = map.get(r.animalId);
    if (!prev || r.withdrawalUntil > prev.until!) map.set(r.animalId, { animalId: a.id, until: r.withdrawalUntil, eventId: e.id, product: e.product, eid: a.eid, lotId: a.currentLotId });
  }
  return [...map.values()];
}

export function createReminder(ctx: FarmCtx, input: { title: string; dueDate: string; lotId?: string | null; eventId?: string | null; notes?: string | null }) {
  assertCan(ctx.role, "write_operational");
  if (!input.title?.trim()) throw badRequest("Ingresá un título para el recordatorio.");
  if (!isIsoDate(input.dueDate)) throw badRequest("Ingresá una fecha válida.");
  if (input.lotId) getLotOrThrow(ctx, input.lotId, false);
  const row = { id: uuid(), farmId: ctx.farm.id, title: input.title.trim(), dueDate: input.dueDate, lotId: input.lotId || null, eventId: input.eventId || null, notes: input.notes?.trim() || null, doneAt: null, createdBy: ctx.user.id, createdAt: nowIso() };
  db.healthReminders.push(row);
  return row;
}

export function completeReminder(ctx: FarmCtx, id: string, done = true) {
  assertCan(ctx.role, "write_operational");
  const r = db.healthReminders.find((x) => x.id === id && x.farmId === ctx.farm.id);
  if (r) r.doneAt = done ? nowIso() : null;
}

export function listReminders(ctx: FarmCtx, includeDone = false) {
  const lotName = new Map(db.lots.map((l) => [l.id, l.name]));
  return db.healthReminders
    .filter((r) => r.farmId === ctx.farm.id && (includeDone || !r.doneAt))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((r) => ({ ...r, lotName: r.lotId ? lotName.get(r.lotId) || null : null }));
}

// Propietarios (DICOSE) y eventos reproductivos
// (port de apps/api/src/services/owners.ts y repro.ts).

import { REPRO_TYPES, type ReproType } from "@rodeo/shared";
import { isIsoDate } from "@rodeo/shared";
import { reproState, type ReproState } from "@rodeo/shared";
import { db, uuid, nowIso } from "../db";
import { assertCan, badRequest, conflict, notFound, type FarmCtx } from "../core";
import { getAnimalOrThrow } from "./animals";
import type { ReproEventRow } from "../schema";

export type OwnerInput = { name: string; dicose?: string | null; notes?: string | null };

export function normalizeDicose(value: string | null | undefined) {
  const s = String(value ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
  if (!s) return null;
  if (!/^[0-9A-Z]{3,20}$/.test(s)) throw badRequest("El DICOSE debe tener entre 3 y 20 caracteres alfanuméricos.");
  return s;
}

export function listOwners(ctx: FarmCtx) {
  const active = db.animals.filter((a) => a.farmId === ctx.farm.id && a.status === "activo");
  return db.owners
    .filter((o) => o.farmId === ctx.farm.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((o) => ({ ...o, activeAnimals: active.filter((a) => a.ownerId === o.id).length, pledgedAnimals: active.filter((a) => a.ownerId === o.id && a.pledgedBank).length }));
}

function getOwnerOrThrow(ctx: FarmCtx, id: string) {
  const o = db.owners.find((x) => x.id === id && x.farmId === ctx.farm.id);
  if (!o) throw notFound("El propietario no existe en este campo.");
  return o;
}

function assertDicoseFree(ctx: FarmCtx, dicose: string | null, exceptId?: string) {
  if (!dicose) return;
  const other = db.owners.find((o) => o.farmId === ctx.farm.id && o.dicose === dicose);
  if (other && other.id !== exceptId) throw conflict(`Ya existe el propietario "${other.name}" con el DICOSE ${dicose}.`);
}

export function createOwner(ctx: FarmCtx, input: OwnerInput) {
  assertCan(ctx.role, "write_operational");
  const name = input.name?.trim();
  if (!name) throw badRequest("Ingresá el nombre del propietario.");
  const dicose = normalizeDicose(input.dicose);
  assertDicoseFree(ctx, dicose);
  const row = { id: uuid(), farmId: ctx.farm.id, name, dicose, notes: input.notes?.trim() || null, createdAt: nowIso() };
  db.owners.push(row);
  return row;
}

export function updateOwner(ctx: FarmCtx, id: string, input: Partial<OwnerInput>) {
  assertCan(ctx.role, "write_operational");
  const current = getOwnerOrThrow(ctx, id);
  if (input.name !== undefined) {
    if (!input.name?.trim()) throw badRequest("Ingresá el nombre del propietario.");
  }
  const dicose = input.dicose !== undefined ? normalizeDicose(input.dicose) : current.dicose;
  if (input.dicose !== undefined) assertDicoseFree(ctx, dicose, current.id);
  if (input.name !== undefined) current.name = input.name.trim();
  current.dicose = dicose;
  if (input.notes !== undefined) current.notes = input.notes?.trim() || null;
  return current;
}

export function deleteOwner(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "manage_farm");
  const current = getOwnerOrThrow(ctx, id);
  for (const a of db.animals) if (a.farmId === ctx.farm.id && a.ownerId === current.id) a.ownerId = null;
  db.owners = db.owners.filter((o) => o.id !== current.id);
}

// ---------- Reproducción ----------

export type ReproInput = { type: string; date?: string | null; months?: number | string | null; bullId?: string | null; notes?: string | null };

export function addReproEvent(ctx: FarmCtx, animalId: string, input: ReproInput) {
  assertCan(ctx.role, "write_operational");
  if (!(REPRO_TYPES as readonly string[]).includes(input.type)) throw badRequest("Tipo de evento reproductivo no válido.");
  const type = input.type as ReproType;
  const animal = getAnimalOrThrow(ctx, animalId);
  if (animal.sex === "macho") throw badRequest("Los eventos reproductivos se registran sobre hembras.");
  if (animal.status !== "activo") throw badRequest("El animal no está activo en este campo.");
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  let months: number | null = null;
  if (type === "prenez") {
    months = Number(input.months);
    if (!Number.isFinite(months) || months < 0 || months > 9) throw badRequest("Indicá los meses de gestación (entre 0 y 9).");
    months = Math.round(months * 10) / 10;
  }
  let bullId: string | null = null;
  if (type === "entore" && input.bullId) {
    const bull = getAnimalOrThrow(ctx, input.bullId);
    if (bull.sex !== "macho") throw badRequest("El toro indicado no es un macho.");
    bullId = bull.id;
  }
  const row: ReproEventRow = { id: uuid(), farmId: ctx.farm.id, animalId: animal.id, type, date, months, bullId, notes: input.notes?.trim() || null, createdBy: ctx.user.id, createdAt: nowIso() };
  db.reproEvents.push(row);
  if (animal.sex !== "hembra") animal.sex = "hembra";
  return row;
}

/** Estado reproductivo de todos los animales del campo. */
export function reproStates(ctx: FarmCtx, asOf: string) {
  const byAnimal = new Map<string, ReproEventRow[]>();
  for (const r of db.reproEvents) {
    if (r.farmId !== ctx.farm.id) continue;
    byAnimal.set(r.animalId, [...(byAnimal.get(r.animalId) || []), r]);
  }
  const states = new Map<string, ReproState>();
  for (const [animalId, list] of byAnimal) states.set(animalId, reproState(list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)), asOf));
  return states;
}

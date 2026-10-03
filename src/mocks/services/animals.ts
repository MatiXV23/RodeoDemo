// Animales: alta, edición, actualización masiva y línea de tiempo
// (port de apps/api/src/services/animals.ts).

import { toDb, toNum } from "@rodeo/shared";
import { EID_REGEX, SEXES, ORIGINS, HEALTH_TYPE_LABELS, REPRO_TYPE_LABELS, defaultSexFor, parseSex, parseCategory, type HealthType, type ReproType } from "@rodeo/shared";
import { isIsoDate, zonedToUtc } from "@rodeo/shared";
import { reproState } from "@rodeo/shared";
import { db, uuid, nowIso } from "../db";
import { assertCan, badRequest, conflict, notFound, type FarmCtx } from "../core";
import type { AnimalRow, MembershipRow, WeighingRow } from "../schema";

export type AnimalInput = {
  eid: string;
  visualTag?: string | null;
  sex?: string | null;
  category?: string | null;
  breed?: string | null;
  birthDateEstimated?: string | null;
  origin?: string | null;
  lotId?: string | null;
  purchaseCost?: number | string | null;
  purchaseDate?: string | null;
  ownerId?: string | null;
  pledge?: PledgeInput | null;
  notes?: string | null;
  weight?: number | string | null;
  date?: string | null;
};

export type PledgeInput = { bank: string; ref?: string | null; since?: string | null };

function normalizePledge(p: PledgeInput | null | undefined, today: string) {
  if (!p || !p.bank?.trim()) return { pledgedBank: null, pledgedRef: null, pledgedSince: null };
  return { pledgedBank: p.bank.trim(), pledgedRef: p.ref?.trim() || null, pledgedSince: p.since && isIsoDate(p.since) ? p.since : today };
}

export function resolveOwnerId(ctx: FarmCtx, ownerId: string | null | undefined) {
  if (!ownerId) return null;
  const o = db.owners.find((x) => x.id === ownerId && x.farmId === ctx.farm.id);
  if (!o) throw notFound("El propietario no existe en este campo.");
  return o.id;
}

export function normalizeEid(eid: string) {
  const s = String(eid || "").replace(/[\s.-]/g, "");
  if (!EID_REGEX.test(s)) throw badRequest("La caravana electrónica debe tener exactamente 15 dígitos.");
  return s;
}

function normalizeSex(sex: string | null | undefined, category: string) {
  const parsed = parseSex(sex);
  if (parsed) return parsed;
  return (SEXES as readonly string[]).includes(String(sex || "").toLowerCase()) ? "sin_dato" : defaultSexFor(category);
}

export function getLotOrThrow(ctx: FarmCtx, lotId: string, mustBeActive = true) {
  const lot = db.lots.find((l) => l.id === lotId && l.farmId === ctx.farm.id);
  if (!lot) throw notFound("El lote no existe en este campo.");
  if (mustBeActive && lot.status !== "activo") throw badRequest(`El lote "${lot.name}" está cerrado.`);
  return lot;
}

export function getAnimalOrThrow(ctx: FarmCtx, idOrEid: string) {
  const byEid = /^\d{15}$/.test(idOrEid);
  const a = db.animals.find((x) => x.farmId === ctx.farm.id && (byEid ? x.eid === idOrEid : x.id === idOrEid));
  if (!a) throw notFound("No encontramos ese animal en este campo.");
  return a;
}

/** Filas para dar de alta animales, con su membresía y pesaje inicial opcional. */
export function buildAnimalRows(ctx: FarmCtx, inputs: AnimalInput[], opts: { reason: string; movementId?: string | null; date: string; sessionId?: string | null }) {
  const animalRows: AnimalRow[] = [];
  const membershipRows: MembershipRow[] = [];
  const weighingRows: WeighingRow[] = [];
  const now = nowIso();
  for (const i of inputs) {
    const category = parseCategory(i.category);
    const id = uuid();
    animalRows.push({
      id,
      farmId: ctx.farm.id,
      eid: normalizeEid(i.eid),
      visualTag: i.visualTag?.trim() || null,
      sex: normalizeSex(i.sex, category),
      category,
      breed: i.breed?.trim() || null,
      birthDateEstimated: i.birthDateEstimated && isIsoDate(i.birthDateEstimated) ? i.birthDateEstimated : null,
      origin: (ORIGINS as readonly string[]).includes(i.origin || "") ? i.origin! : "sin_dato",
      status: "activo",
      currentLotId: i.lotId || null,
      purchaseCost: i.purchaseCost !== null && i.purchaseCost !== undefined && i.purchaseCost !== "" ? toDb(i.purchaseCost, 2) : null,
      purchaseDate: i.purchaseDate && isIsoDate(i.purchaseDate) ? i.purchaseDate : null,
      ownerId: i.ownerId || null,
      ...normalizePledge(i.pledge, opts.date),
      notes: i.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    if (i.lotId) {
      membershipRows.push({ id: uuid(), farmId: ctx.farm.id, animalId: id, lotId: i.lotId, fromDate: opts.date, toDate: null, reason: opts.reason, movementId: opts.movementId ?? null, createdAt: now });
    }
    if (i.weight !== null && i.weight !== undefined && i.weight !== "" && opts.sessionId) {
      weighingRows.push({
        id: uuid(),
        farmId: ctx.farm.id,
        sessionId: opts.sessionId,
        animalId: id,
        lotId: i.lotId || null,
        weight: toDb(i.weight, 2),
        weighedAt: zonedToUtc(opts.date, "12:00:00", ctx.farm.timezone),
        date: opts.date,
        mode: "manual",
        observation: null,
        reliable: true,
        createdAt: now,
      });
    }
  }
  return { animalRows, membershipRows, weighingRows };
}

export function assertEidsAvailable(ctx: FarmCtx, eids: string[]) {
  const unique = new Set(eids);
  if (unique.size !== eids.length) throw badRequest("Hay caravanas repetidas en la lista.");
  if (!eids.length) return;
  const existing = db.animals.filter((a) => a.farmId === ctx.farm.id && unique.has(a.eid));
  if (existing.length) throw conflict(`Ya existen animales con estas caravanas: ${existing.map((e) => e.eid).join(", ")}.`);
}

export function createAnimal(ctx: FarmCtx, input: AnimalInput) {
  assertCan(ctx.role, "write_operational");
  const eid = normalizeEid(input.eid);
  assertEidsAvailable(ctx, [eid]);
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  let lotId: string | null = null;
  let category = input.category || null;
  if (input.lotId) {
    const lot = getLotOrThrow(ctx, input.lotId);
    lotId = lot.id;
    category = category || lot.category;
  }
  const ownerId = resolveOwnerId(ctx, input.ownerId);
  if (input.pledge?.bank) assertCan(ctx.role, "manage_farm", "Solo un administrador puede marcar animales prendados al banco.");
  const hasWeight = input.weight !== null && input.weight !== undefined && input.weight !== "";
  const sessionId = hasWeight ? uuid() : null;
  const { animalRows, membershipRows, weighingRows } = buildAnimalRows(ctx, [{ ...input, eid, lotId, category, ownerId }], { reason: "alta", date, sessionId });
  db.animals.push(...animalRows);
  db.lotMemberships.push(...membershipRows);
  if (sessionId) {
    db.weighingSessions.push({ id: sessionId, farmId: ctx.farm.id, date, name: "Alta de animal", origin: "manual", fileKey: null, fileName: null, fileHash: null, rowsHash: null, notes: null, createdBy: ctx.user.id, createdAt: nowIso() });
    db.weighings.push(...weighingRows);
  }
  return animalRows[0];
}

export function updateAnimal(ctx: FarmCtx, id: string, input: Partial<AnimalInput>) {
  assertCan(ctx.role, "write_operational");
  const current = getAnimalOrThrow(ctx, id);
  const patch: Partial<AnimalRow> = { updatedAt: nowIso() };
  if (input.eid !== undefined) {
    const eid = normalizeEid(input.eid);
    if (eid !== current.eid) {
      assertEidsAvailable(ctx, [eid]);
      patch.eid = eid;
    }
  }
  if (input.visualTag !== undefined) patch.visualTag = input.visualTag?.trim() || null;
  if (input.category !== undefined) patch.category = parseCategory(input.category);
  if (input.sex !== undefined) patch.sex = normalizeSex(input.sex, patch.category || current.category);
  if (input.breed !== undefined) patch.breed = input.breed?.trim() || null;
  if (input.birthDateEstimated !== undefined) patch.birthDateEstimated = input.birthDateEstimated && isIsoDate(input.birthDateEstimated) ? input.birthDateEstimated : null;
  if (input.origin !== undefined) patch.origin = (ORIGINS as readonly string[]).includes(input.origin || "") ? input.origin! : "sin_dato";
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.purchaseCost !== undefined) {
    assertCan(ctx.role, "write_money");
    patch.purchaseCost = input.purchaseCost === null || input.purchaseCost === "" ? null : toDb(input.purchaseCost, 2);
  }
  if (input.purchaseDate !== undefined) patch.purchaseDate = input.purchaseDate && isIsoDate(input.purchaseDate) ? input.purchaseDate : null;
  if (input.ownerId !== undefined) patch.ownerId = resolveOwnerId(ctx, input.ownerId);
  if (input.pledge !== undefined) {
    assertCan(ctx.role, "manage_farm", "Solo un administrador puede modificar la prenda bancaria.");
    Object.assign(patch, normalizePledge(input.pledge, ctx.today));
  }
  Object.assign(current, patch);
  return current;
}

export type BulkAnimalInput = { eids?: string[]; ids?: string[]; ownerId?: string | null; pledge?: PledgeInput | null };

export function bulkUpdateAnimals(ctx: FarmCtx, input: BulkAnimalInput) {
  assertCan(ctx.role, "write_operational");
  if (input.ownerId === undefined && input.pledge === undefined) throw badRequest("Indicá qué cambiar: propietario o prenda bancaria.");
  if (input.pledge !== undefined) assertCan(ctx.role, "manage_farm", "Solo un administrador puede modificar la prenda bancaria.");
  const eids = [...new Set((input.eids || []).map((e) => normalizeEid(e)))];
  const ids = new Set(input.ids || []);
  if (!eids.length && !ids.size) throw badRequest("Ingresá al menos una caravana.");
  const eidSet = new Set(eids);
  const targets = db.animals.filter((a) => a.farmId === ctx.farm.id && (eidSet.has(a.eid) || ids.has(a.id)));
  const foundEids = new Set(targets.map((a) => a.eid));
  const missing = eids.filter((e) => !foundEids.has(e));
  const patch: Partial<AnimalRow> = { updatedAt: nowIso() };
  if (input.ownerId !== undefined) patch.ownerId = resolveOwnerId(ctx, input.ownerId);
  if (input.pledge !== undefined) Object.assign(patch, normalizePledge(input.pledge, ctx.today));
  for (const a of targets) Object.assign(a, patch);
  return { updated: targets.length, missing };
}

export type TimelineItem = { id: string; kind: "pesada" | "movimiento" | "sanidad" | "lote" | "reproduccion" | "nota"; date: string; at: string; title: string; detail: string; data?: Record<string, unknown> };

/** Línea de tiempo unificada de un animal: pesos, movimientos, sanidad y lotes. */
export function animalTimeline(ctx: FarmCtx, id: string) {
  const animal = getAnimalOrThrow(ctx, id);
  const sessionById = new Map(db.weighingSessions.map((s) => [s.id, s]));
  const ws = db.weighings.filter((w) => w.animalId === animal.id).sort((a, b) => b.weighedAt.localeCompare(a.weighedAt));
  const movementById = new Map(db.movements.map((m) => [m.id, m]));
  const ms = db.movementAnimals.filter((m) => m.animalId === animal.id).map((ma) => ({ ...ma, m: movementById.get(ma.movementId)! })).filter((x) => x.m);
  const eventById = new Map(db.healthEvents.map((h) => [h.id, h]));
  const hs = db.healthEventAnimals.filter((h) => h.animalId === animal.id).map((ha) => ({ h: eventById.get(ha.eventId)!, until: ha.withdrawalUntil })).filter((x) => x.h);
  const lotById = new Map(db.lots.map((l) => [l.id, l]));
  const memberships = db.lotMemberships.filter((m) => m.animalId === animal.id).map((m) => ({ m, lotName: lotById.get(m.lotId)?.name || "Lote" }));
  const rs = db.reproEvents.filter((r) => r.animalId === animal.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const owner = animal.ownerId ? db.owners.find((o) => o.id === animal.ownerId) : null;
  const bullEid = new Map(db.animals.filter((a) => rs.some((r) => r.bullId === a.id)).map((b) => [b.id, b.eid]));
  const showMoney = ctx.role !== "operator";
  const items: TimelineItem[] = [];
  for (const w of ws) {
    const s = sessionById.get(w.sessionId);
    items.push({
      id: "w-" + w.id,
      kind: "pesada",
      date: w.date,
      at: w.weighedAt,
      title: `${toNum(w.weight, 1)} kg`,
      detail: `${s?.name || "Pesada"} · ${s?.origin === "importada" ? "importada" : "manual"}${w.mode === "manual" ? " · tipeado en el lector" : ""}${w.observation ? ` · ${w.observation}` : ""}`,
      data: { weight: toNum(w.weight, 1), mode: w.mode, reliable: w.reliable, observation: w.observation, sessionId: w.sessionId },
    });
  }
  for (const { m, weight, amount, costBasis } of ms) {
    items.push({
      id: "m-" + m.id,
      kind: "movimiento",
      date: m.date,
      at: m.createdAt,
      title: ({ compra: "Compra", venta: "Venta", nacimiento: "Nacimiento", muerte: "Muerte", transferencia_lote: "Transferencia entre lotes", transferencia_campo: "Transferencia entre campos" } as Record<string, string>)[m.type] || m.type,
      detail: [m.counterparty, weight ? `${toNum(weight, 1)} kg` : null, showMoney && amount ? `${m.currency || ctx.farm.currency} ${toNum(amount, 2)}` : null, m.cause].filter(Boolean).join(" · "),
      data: showMoney ? { type: m.type, amount, costBasis } : { type: m.type },
    });
  }
  for (const { h, until } of hs) {
    items.push({
      id: "h-" + h.id,
      kind: "sanidad",
      date: h.date,
      at: h.createdAt,
      title: HEALTH_TYPE_LABELS[h.type as HealthType] || h.type,
      detail: `${h.product}${h.dose ? ` · ${h.dose}` : ""}${h.withdrawalDays ? ` · retiro ${h.withdrawalDays} días (hasta ${until})` : ""}`,
      data: { withdrawalUntil: until, type: h.type },
    });
  }
  for (const { m, lotName } of memberships) {
    items.push({ id: "l-" + m.id, kind: "lote", date: m.fromDate, at: m.createdAt, title: `Ingreso a ${lotName}`, detail: ({ alta: "Alta manual", compra: "Por compra", importacion: "Por importación de pesada", transferencia: "Por transferencia", nacimiento: "Por nacimiento" } as Record<string, string>)[m.reason] || m.reason });
    if (m.toDate) items.push({ id: "lo-" + m.id, kind: "lote", date: m.toDate, at: m.toDate + "T00:00:00.000Z", title: `Salida de ${lotName}`, detail: "" });
  }
  for (const r of rs) {
    const detail = [r.type === "prenez" ? `${r.months} meses de gestación` : null, r.type === "entore" ? (r.bullId ? `toro ${bullEid.get(r.bullId) || r.bullId}` : "sin toro indicado") : null, r.notes].filter(Boolean).join(" · ");
    items.push({ id: "r-" + r.id, kind: "reproduccion", date: r.date, at: r.createdAt, title: REPRO_TYPE_LABELS[r.type as ReproType] || r.type, detail, data: { type: r.type, months: r.months, bullId: r.bullId } });
  }
  if (animal.pledgedBank) items.push({ id: "p-" + animal.id, kind: "nota", date: animal.pledgedSince || animal.createdAt.slice(0, 10), at: animal.updatedAt, title: `Prenda bancaria · ${animal.pledgedBank}`, detail: animal.pledgedRef ? `Referencia ${animal.pledgedRef}` : "A nombre del banco por préstamo" });
  if (animal.notes) items.push({ id: "n-" + animal.id, kind: "nota", date: animal.createdAt.slice(0, 10), at: animal.createdAt, title: "Nota", detail: animal.notes });
  items.sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
  const repro = reproState(rs, ctx.today);
  return {
    animal: showMoney ? animal : { ...animal, purchaseCost: null },
    owner: owner ? { id: owner.id, name: owner.name, dicose: owner.dicose } : null,
    repro: { ...repro, bullEid: repro.bullId ? bullEid.get(repro.bullId) || null : null },
    timeline: items,
    lots: memberships.map(({ m, lotName }) => ({ ...m, lotName })),
  };
}

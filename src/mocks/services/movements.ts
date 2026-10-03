// Movimientos: compra, venta (con vista previa), muerte, nacimiento y
// transferencias (port de apps/api/src/services/movements.ts).

import { D, ZERO, sum, toDb, money2, type Decimal } from "@rodeo/shared";
import { parseCategory } from "@rodeo/shared";
import { isIsoDate } from "@rodeo/shared";
import { db, uuid, nowIso, deleteAnimalsCascade } from "../db";
import { assertCan, can, badRequest, conflict, forbidden, notFound, type FarmCtx } from "../core";
import { buildAnimalRows, assertEidsAvailable, getLotOrThrow, getAnimalOrThrow, normalizeEid, resolveOwnerId } from "./animals";
import { weighingInsertRows, newSession } from "./weighings";
import { loadFarmMetrics } from "./metrics";
import type { AnimalRow, LotRow, MovementRow } from "../schema";

function validDate(ctx: FarmCtx, date: string | null | undefined) {
  const d = date && isIsoDate(date) ? date : ctx.today;
  if (d > ctx.today) throw badRequest("La fecha no puede ser futura.");
  return d;
}

function loadActiveAnimals(ctx: FarmCtx, animalIds: string[]) {
  const ids = [...new Set(animalIds)].filter(Boolean);
  if (!ids.length) throw badRequest("Seleccioná al menos un animal.");
  const set = new Set(ids);
  const rows = db.animals.filter((a) => a.farmId === ctx.farm.id && set.has(a.id));
  if (rows.length !== ids.length) throw notFound("Alguno de los animales no existe en este campo.");
  const inactive = rows.filter((a) => a.status !== "activo");
  if (inactive.length) throw badRequest(`Hay animales que no están activos: ${inactive.map((a) => a.eid).join(", ")}.`);
  return rows;
}

function closeMemberships(ctx: FarmCtx, animalIds: string[], date: string) {
  const set = new Set(animalIds);
  for (const m of db.lotMemberships) if (m.farmId === ctx.farm.id && set.has(m.animalId) && m.toDate === null) m.toDate = date;
}

function setAnimals(ids: string[], patch: Partial<AnimalRow>) {
  const set = new Set(ids);
  const updatedAt = nowIso();
  for (const a of db.animals) if (set.has(a.id)) Object.assign(a, patch, { updatedAt });
}

function movementRow(ctx: FarmCtx, m: Partial<MovementRow> & { id: string; type: string; date: string }): MovementRow {
  const now = nowIso();
  return {
    farmId: ctx.farm.id,
    counterparty: null,
    headCount: 0,
    totalWeight: null,
    priceMode: null,
    unitPrice: null,
    currency: null,
    commission: null,
    freight: null,
    grossAmount: null,
    netAmount: null,
    documentRef: null,
    notes: null,
    cause: null,
    fromLotId: null,
    toLotId: null,
    toFarmId: null,
    allocatedCost: null,
    result: null,
    createdBy: ctx.user.id,
    createdAt: now,
    updatedBy: null,
    updatedAt: now,
    ...m,
  };
}

// ---------- Compra ----------

export type PurchaseInput = {
  date?: string | null;
  counterparty: string;
  lotId: string;
  priceMode: "kg" | "cabeza";
  unitPrice: string | number;
  currency?: string | null;
  commission?: string | number | null;
  freight?: string | number | null;
  documentRef?: string | null;
  notes?: string | null;
  animals?: { eid: string; weight?: string | number | null; visualTag?: string | null; category?: string | null; sex?: string | null }[];
  existingAnimalIds?: string[];
  category?: string | null;
  ownerId?: string | null;
};

export function registerPurchase(ctx: FarmCtx, input: PurchaseInput) {
  assertCan(ctx.role, "write_money");
  const date = validDate(ctx, input.date);
  const lot = getLotOrThrow(ctx, input.lotId);
  const unitPrice = D(input.unitPrice);
  if (!unitPrice.isFinite() || unitPrice.lte(0)) throw badRequest("Ingresá un precio válido.");
  const priceMode = input.priceMode === "cabeza" ? "cabeza" : "kg";
  const newInputs = (input.animals || []).map((a) => ({ ...a, eid: normalizeEid(a.eid) }));
  const existingIds = [...new Set(input.existingAnimalIds || [])];
  if (!newInputs.length && !existingIds.length) throw badRequest("Indicá las caravanas compradas.");
  assertEidsAvailable(ctx, newInputs.map((a) => a.eid));
  const existing = existingIds.length ? loadActiveAnimals(ctx, existingIds) : [];
  const metrics = existing.length ? loadFarmMetrics(ctx) : null;

  type Head = { id: string; eid: string; weight: Decimal | null; isNew: boolean };
  const heads: Head[] = [];
  const sessionId = uuid();
  const movementId = uuid();
  const category = parseCategory(input.category || lot.category);
  const ownerId = resolveOwnerId(ctx, input.ownerId);
  const built = buildAnimalRows(
    ctx,
    newInputs.map((a) => ({ eid: a.eid, lotId: lot.id, category: a.category || category, sex: a.sex, visualTag: a.visualTag, origin: "compra", purchaseDate: date, ownerId })),
    { reason: "compra", movementId, date, sessionId: null },
  );
  built.animalRows.forEach((row, i) => heads.push({ id: row.id, eid: row.eid, weight: newInputs[i].weight ? D(newInputs[i].weight!) : null, isNew: true }));
  for (const a of existing) heads.push({ id: a.id, eid: a.eid, weight: metrics!.animals.get(a.id)?.lastWeight ?? null, isNew: false });

  if (priceMode === "kg" && heads.some((h) => !h.weight || h.weight.lte(0))) {
    throw badRequest("Con precio por kg, cada animal necesita un peso de ingreso (o un peso registrado).");
  }
  const totalWeight = sum(heads.map((h) => h.weight ?? ZERO));
  const gross = priceMode === "kg" ? totalWeight.times(unitPrice) : unitPrice.times(heads.length);
  const commission = D(input.commission ?? 0);
  const freight = D(input.freight ?? 0);
  const net = gross.plus(commission).plus(freight);
  const extrasPerHead = commission.plus(freight).div(heads.length);
  const perHead = heads.map((h) => {
    const amount = priceMode === "kg" ? (h.weight ?? ZERO).times(unitPrice) : unitPrice;
    return { ...h, amount, cost: amount.plus(extrasPerHead) };
  });

  if (built.animalRows.length) {
    const costByEid = new Map(perHead.map((h) => [h.eid, money2(h.cost)]));
    db.animals.push(...built.animalRows.map((r) => ({ ...r, purchaseCost: costByEid.get(r.eid)! })));
    db.lotMemberships.push(...built.membershipRows);
  }
  for (const h of perHead.filter((h) => !h.isNew)) {
    const a = db.animals.find((x) => x.id === h.id)!;
    Object.assign(a, { origin: "compra", purchaseCost: money2(h.cost), purchaseDate: date, updatedAt: nowIso() });
  }
  const weighingRows = weighingInsertRows(
    ctx,
    sessionId,
    perHead.filter((h) => h.isNew && h.weight).map((h) => ({ animalId: h.id, lotId: lot.id, weight: h.weight!, date, mode: "manual" as const, observation: "Peso de compra", reliable: true })),
  );
  if (weighingRows.length) {
    db.weighingSessions.push(newSession(ctx, { id: sessionId, date, name: `Compra · ${input.counterparty || "sin contraparte"}`, origin: "manual" }));
    db.weighings.push(...weighingRows);
  }
  db.movements.push(
    movementRow(ctx, {
      id: movementId,
      type: "compra",
      date,
      counterparty: input.counterparty?.trim() || null,
      headCount: heads.length,
      totalWeight: totalWeight.gt(0) ? toDb(totalWeight, 2) : null,
      priceMode,
      unitPrice: toDb(unitPrice, 4),
      currency: (input.currency || ctx.farm.currency).toUpperCase(),
      commission: money2(commission),
      freight: money2(freight),
      grossAmount: money2(gross),
      netAmount: money2(net),
      documentRef: input.documentRef?.trim() || null,
      notes: input.notes?.trim() || null,
      toLotId: lot.id,
    }),
  );
  db.movementAnimals.push(...perHead.map((h) => ({ movementId, animalId: h.id, weight: h.weight ? toDb(h.weight, 2) : null, amount: money2(h.amount), costBasis: money2(h.cost) })));
  return { movementId, created: built.animalRows.length, associated: existing.length, gross: money2(gross), net: money2(net) };
}

// ---------- Venta ----------

export type SaleInput = {
  date?: string | null;
  counterparty: string;
  animalIds: string[];
  priceMode: "kg" | "cabeza";
  unitPrice: string | number;
  currency?: string | null;
  commission?: string | number | null;
  freight?: string | number | null;
  documentRef?: string | null;
  notes?: string | null;
  weights?: Record<string, string | number>;
  totalWeight?: string | number | null;
  acknowledgeWithdrawal?: boolean;
};

export function previewSale(ctx: FarmCtx, input: SaleInput) {
  assertCan(ctx.role, "write_money");
  const date = validDate(ctx, input.date);
  const rows = loadActiveAnimals(ctx, input.animalIds);
  const metrics = loadFarmMetrics(ctx, { asOf: date });
  const unitPrice = D(input.unitPrice);
  if (!unitPrice.isFinite() || unitPrice.lte(0)) throw badRequest("Ingresá un precio válido.");
  const priceMode = input.priceMode === "cabeza" ? "cabeza" : "kg";
  const providedTotal = input.totalWeight ? D(input.totalWeight) : null;
  const heads = rows.map((a) => {
    const m = metrics.animals.get(a.id)!;
    let weight = input.weights?.[a.id] !== undefined ? D(input.weights[a.id]) : m.lastWeight;
    if (providedTotal && !input.weights) weight = providedTotal.div(rows.length);
    return { animal: a, weight, cost: m.accumulatedCost, withdrawalUntil: m.withdrawalUntil && m.withdrawalUntil >= date ? m.withdrawalUntil : null, lotId: a.currentLotId };
  });
  if (priceMode === "kg" && heads.some((h) => !h.weight || h.weight.lte(0))) {
    throw badRequest("Con precio por kg, cada animal necesita un peso (registrado o de venta).");
  }
  const totalWeight = sum(heads.map((h) => h.weight ?? ZERO));
  const gross = priceMode === "kg" ? totalWeight.times(unitPrice) : unitPrice.times(heads.length);
  const commission = D(input.commission ?? 0);
  const freight = D(input.freight ?? 0);
  const net = gross.minus(commission).minus(freight);
  const allocatedCost = sum(heads.map((h) => h.cost));
  const result = net.minus(allocatedCost);
  const withdrawals = heads.filter((h) => h.withdrawalUntil);
  const lotIds = [...new Set(heads.map((h) => h.lotId).filter(Boolean))];
  return {
    date,
    heads: heads.map((h) => ({
      animalId: h.animal.id,
      eid: h.animal.eid,
      visualTag: h.animal.visualTag,
      weight: h.weight ? toDb(h.weight, 2) : null,
      amount: money2(priceMode === "kg" ? (h.weight ?? ZERO).times(unitPrice) : unitPrice),
      cost: money2(h.cost),
      withdrawalUntil: h.withdrawalUntil,
    })),
    totalWeight: toDb(totalWeight, 2),
    gross: money2(gross),
    commission: money2(commission),
    freight: money2(freight),
    net: money2(net),
    allocatedCost: money2(allocatedCost),
    result: money2(result),
    withdrawals: withdrawals.map((h) => ({ eid: h.animal.eid, until: h.withdrawalUntil })),
    blocked: withdrawals.length > 0 && ctx.farm.withdrawalPolicy === "block",
    policy: ctx.farm.withdrawalPolicy,
    fromLotId: (lotIds.length === 1 ? lotIds[0] : null) as string | null,
    unitPrice: toDb(unitPrice, 4),
    priceMode,
  };
}

export function registerSale(ctx: FarmCtx, input: SaleInput) {
  const p = previewSale(ctx, input);
  if (p.withdrawals.length) {
    if (p.blocked) throw conflict(`Hay animales con retiro sanitario vigente: ${p.withdrawals.map((w) => `${w.eid} (hasta ${w.until})`).join(", ")}.`, { code: "retiro_vigente", withdrawals: p.withdrawals });
    if (!input.acknowledgeWithdrawal) throw conflict("Hay animales con retiro sanitario vigente. Confirmá que igual querés registrar la venta.", { code: "retiro_advertencia", withdrawals: p.withdrawals });
  }
  const movementId = uuid();
  const animalIds = p.heads.map((h) => h.animalId);
  // Lote de cada animal antes de cerrar su pertenencia (para la pesada de venta).
  const lotOf = new Map(db.animals.filter((a) => animalIds.includes(a.id)).map((a) => [a.id, a.currentLotId]));
  db.movements.push(
    movementRow(ctx, {
      id: movementId,
      type: "venta",
      date: p.date,
      counterparty: input.counterparty?.trim() || null,
      headCount: animalIds.length,
      totalWeight: p.totalWeight,
      priceMode: p.priceMode,
      unitPrice: p.unitPrice,
      currency: (input.currency || ctx.farm.currency).toUpperCase(),
      commission: p.commission,
      freight: p.freight,
      grossAmount: p.gross,
      netAmount: p.net,
      documentRef: input.documentRef?.trim() || null,
      notes: input.notes?.trim() || null,
      fromLotId: p.fromLotId,
      allocatedCost: p.allocatedCost,
      result: p.result,
    }),
  );
  db.movementAnimals.push(...p.heads.map((h) => ({ movementId, animalId: h.animalId, weight: h.weight, amount: h.amount, costBasis: h.cost })));
  setAnimals(animalIds, { status: "vendido" });
  closeMemberships(ctx, animalIds, p.date);
  const saleWeights = input.weights ? p.heads.filter((h) => input.weights![h.animalId] !== undefined && h.weight) : [];
  if (saleWeights.length) {
    const sessionId = uuid();
    db.weighingSessions.push(newSession(ctx, { id: sessionId, date: p.date, name: `Venta · ${input.counterparty || "sin contraparte"}`, origin: "manual" }));
    db.weighings.push(...weighingInsertRows(ctx, sessionId, saleWeights.map((h) => ({ animalId: h.animalId, lotId: lotOf.get(h.animalId) ?? null, weight: h.weight!, date: p.date, mode: "manual" as const, observation: "Peso de venta", reliable: true }))));
  }
  return { movementId, ...p };
}

// ---------- Muerte ----------

export function registerDeath(ctx: FarmCtx, input: { date?: string | null; animalIds: string[]; cause?: string | null; notes?: string | null }) {
  assertCan(ctx.role, "write_operational");
  const date = validDate(ctx, input.date);
  const rows = loadActiveAnimals(ctx, input.animalIds);
  const metrics = loadFarmMetrics(ctx, { asOf: date });
  const lotIds = [...new Set(rows.map((a) => a.currentLotId).filter(Boolean))] as string[];
  const movementId = uuid();
  const heads = rows.map((a) => {
    const m = metrics.animals.get(a.id)!;
    return { movementId, animalId: a.id, weight: m.lastWeight ? toDb(m.lastWeight, 2) : null, amount: null, costBasis: money2(m.accumulatedCost) };
  });
  db.movements.push(movementRow(ctx, { id: movementId, type: "muerte", date, headCount: rows.length, cause: input.cause?.trim() || null, notes: input.notes?.trim() || null, fromLotId: lotIds.length === 1 ? lotIds[0] : null, allocatedCost: money2(sum(heads.map((h) => h.costBasis))) }));
  db.movementAnimals.push(...heads);
  setAnimals(rows.map((a) => a.id), { status: "muerto" });
  closeMemberships(ctx, rows.map((a) => a.id), date);
  return { movementId };
}

// ---------- Nacimiento ----------

export function registerBirth(
  ctx: FarmCtx,
  input: {
    date?: string | null;
    lotId: string;
    animals: { eid: string; visualTag?: string | null; sex?: string | null; weight?: string | number | null; breed?: string | null; motherId?: string | null }[];
    notes?: string | null;
    ownerId?: string | null;
    motherId?: string | null;
  },
) {
  assertCan(ctx.role, "write_operational");
  const date = validDate(ctx, input.date);
  const lot = getLotOrThrow(ctx, input.lotId);
  const inputs = (input.animals || []).map((a) => ({ ...a, eid: normalizeEid(a.eid) }));
  if (!inputs.length) throw badRequest("Indicá al menos un ternero.");
  assertEidsAvailable(ctx, inputs.map((a) => a.eid));
  const explicitOwner = resolveOwnerId(ctx, input.ownerId);
  const motherIds = [...new Set(inputs.map((a) => a.motherId || input.motherId).filter((m): m is string => !!m))];
  const mothers = new Map<string, AnimalRow>();
  for (const m of motherIds) {
    const mother = getAnimalOrThrow(ctx, m);
    if (mother.sex === "macho") throw badRequest(`La caravana ${mother.eid} es un macho; no puede registrarse como madre.`);
    if (mother.status !== "activo") throw badRequest(`La madre ${mother.eid} no está activa en este campo.`);
    mothers.set(m, mother);
  }
  const movementId = uuid();
  const sessionId = uuid();
  const built = buildAnimalRows(
    ctx,
    inputs.map((a) => {
      const mother = mothers.get(a.motherId || input.motherId || "");
      return { eid: a.eid, lotId: lot.id, category: a.sex === "hembra" ? "ternera" : "ternero", sex: a.sex, visualTag: a.visualTag, breed: a.breed || mother?.breed, origin: "nacimiento", birthDateEstimated: date, weight: a.weight, purchaseCost: "0", ownerId: explicitOwner || mother?.ownerId || null, notes: mother ? `Madre: ${mother.eid}` : null };
    }),
    { reason: "nacimiento", movementId, date, sessionId },
  );
  db.animals.push(...built.animalRows);
  db.lotMemberships.push(...built.membershipRows);
  db.movements.push(movementRow(ctx, { id: movementId, type: "nacimiento", date, headCount: inputs.length, notes: input.notes?.trim() || null, toLotId: lot.id }));
  db.movementAnimals.push(...built.animalRows.map((a) => ({ movementId, animalId: a.id, weight: null, amount: null, costBasis: "0" })));
  if (built.weighingRows.length) {
    db.weighingSessions.push(newSession(ctx, { id: sessionId, date, name: "Peso al nacer", origin: "manual" }));
    db.weighings.push(...built.weighingRows);
  }
  for (const [key, mother] of mothers) {
    const calves = inputs.filter((a) => (a.motherId || input.motherId) === key).map((a) => a.eid);
    db.reproEvents.push({ id: uuid(), farmId: ctx.farm.id, animalId: mother.id, type: "parto", date, months: null, bullId: null, notes: `Cría: ${calves.join(", ")}`, createdBy: ctx.user.id, createdAt: nowIso() });
    if (mother.sex !== "hembra") mother.sex = "hembra";
  }
  return { movementId, created: built.animalRows.length };
}

// ---------- Transferencias ----------

export function transferBetweenLots(ctx: FarmCtx, input: { date?: string | null; animalIds: string[]; toLotId: string; notes?: string | null }) {
  assertCan(ctx.role, "write_operational");
  const date = validDate(ctx, input.date);
  const target = getLotOrThrow(ctx, input.toLotId);
  const rows = loadActiveAnimals(ctx, input.animalIds);
  const moving = rows.filter((a) => a.currentLotId !== target.id);
  if (!moving.length) throw badRequest("Los animales ya están en ese lote.");
  const fromLots = [...new Set(moving.map((a) => a.currentLotId).filter(Boolean))] as string[];
  const movementId = uuid();
  const ids = moving.map((a) => a.id);
  db.movements.push(movementRow(ctx, { id: movementId, type: "transferencia_lote", date, headCount: moving.length, notes: input.notes?.trim() || null, fromLotId: fromLots.length === 1 ? fromLots[0] : null, toLotId: target.id }));
  db.movementAnimals.push(...ids.map((animalId) => ({ movementId, animalId, weight: null, amount: null, costBasis: null })));
  closeMemberships(ctx, ids, date);
  const now = nowIso();
  db.lotMemberships.push(...ids.map((animalId) => ({ id: uuid(), farmId: ctx.farm.id, animalId, lotId: target.id, fromDate: date, toDate: null, reason: "transferencia", movementId, createdAt: now })));
  setAnimals(ids, { currentLotId: target.id });
  return { movementId, moved: ids.length };
}

export function transferBetweenFarms(ctx: FarmCtx, input: { date?: string | null; animalIds: string[]; toFarmId: string; toLotId?: string | null; notes?: string | null }) {
  assertCan(ctx.role, "write_operational");
  const date = validDate(ctx, input.date);
  if (input.toFarmId === ctx.farm.id) throw badRequest("Elegí un campo distinto al actual.");
  const membership = db.farmMembers.find((m) => m.farmId === input.toFarmId && m.userId === ctx.user.id);
  if (!membership || !can(membership.role, "write_operational")) throw forbidden("No tenés permisos de carga en el campo de destino.");
  const targetFarm = db.farms.find((f) => f.id === input.toFarmId);
  if (!targetFarm) throw notFound("El campo de destino no existe.");
  let targetLot: LotRow | null = null;
  if (input.toLotId) {
    targetLot = db.lots.find((l) => l.id === input.toLotId && l.farmId === targetFarm.id && l.status === "activo") ?? null;
    if (!targetLot) throw notFound("El lote de destino no existe o está cerrado.");
  }
  const rows = loadActiveAnimals(ctx, input.animalIds);
  const metrics = loadFarmMetrics(ctx, { asOf: date });
  const eids = new Set(rows.map((a) => a.eid));
  const existingInTarget = db.animals.filter((a) => a.farmId === targetFarm.id && eids.has(a.eid));
  if (existingInTarget.length) throw conflict(`Estas caravanas ya existen en ${targetFarm.name}: ${existingInTarget.map((e) => e.eid).join(", ")}.`);
  const movementId = uuid();
  const targetMovementId = uuid();
  const targetCtx: FarmCtx = { ...ctx, farm: targetFarm, role: membership.role };
  const built = buildAnimalRows(
    targetCtx,
    rows.map((a) => ({ eid: a.eid, visualTag: a.visualTag, sex: a.sex, category: a.category, breed: a.breed, birthDateEstimated: a.birthDateEstimated, origin: a.origin, lotId: targetLot?.id ?? null, purchaseCost: money2(metrics.animals.get(a.id)!.accumulatedCost), purchaseDate: a.purchaseDate, notes: a.notes })),
    { reason: "transferencia", movementId: targetMovementId, date, sessionId: null },
  );
  const sessionId = uuid();
  const weighingRows = weighingInsertRows(
    targetCtx,
    sessionId,
    rows
      .map((a, i) => ({ a, id: built.animalRows[i].id, w: metrics.animals.get(a.id)!.lastWeight }))
      .filter((x) => x.w)
      .map((x) => ({ animalId: x.id, lotId: targetLot?.id ?? null, weight: x.w!, date, mode: "manual" as const, observation: `Transferido desde ${ctx.farm.name}`, reliable: true })),
  );
  const ids = rows.map((a) => a.id);
  const lotIds = [...new Set(rows.map((a) => a.currentLotId).filter(Boolean))] as string[];
  db.movements.push(
    movementRow(ctx, { id: movementId, type: "transferencia_campo", date, headCount: ids.length, notes: input.notes?.trim() || null, fromLotId: lotIds.length === 1 ? lotIds[0] : null, toFarmId: targetFarm.id, counterparty: targetFarm.name }),
    movementRow(targetCtx, { id: targetMovementId, type: "transferencia_campo", date, headCount: ids.length, notes: `Recibidos desde ${ctx.farm.name}`, toLotId: targetLot?.id ?? null, toFarmId: ctx.farm.id, counterparty: ctx.farm.name }),
  );
  db.movementAnimals.push(...ids.map((animalId, i) => ({ movementId, animalId, weight: null, amount: null, costBasis: money2(metrics.animals.get(rows[i].id)!.accumulatedCost) })));
  setAnimals(ids, { status: "transferido" });
  closeMemberships(ctx, ids, date);
  db.animals.push(...built.animalRows);
  db.movementAnimals.push(...built.animalRows.map((a) => ({ movementId: targetMovementId, animalId: a.id, weight: null, amount: null, costBasis: a.purchaseCost ?? null })));
  db.lotMemberships.push(...built.membershipRows);
  if (weighingRows.length) {
    db.weighingSessions.push(newSession(targetCtx, { id: sessionId, date, name: `Ingreso desde ${ctx.farm.name}`, origin: "manual" }));
    db.weighings.push(...weighingRows);
  }
  return { movementId, targetMovementId, transferred: ids.length };
}

// ---------- Consulta y eliminación ----------

export function stripMoney(m: MovementRow): MovementRow {
  return { ...m, unitPrice: null, commission: null, freight: null, grossAmount: null, netAmount: null, allocatedCost: null, result: null };
}

export function listMovements(ctx: FarmCtx) {
  const rows = db.movements.filter((m) => m.farmId === ctx.farm.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return can(ctx.role, "read_money") ? rows : rows.map(stripMoney);
}

export function movementDetail(ctx: FarmCtx, id: string) {
  const m = db.movements.find((x) => x.id === id && x.farmId === ctx.farm.id);
  if (!m) throw notFound("El movimiento no existe.");
  const animalById = new Map(db.animals.map((a) => [a.id, a]));
  const heads = db.movementAnimals
    .filter((h) => h.movementId === m.id && animalById.has(h.animalId))
    .map((h) => {
      const a = animalById.get(h.animalId)!;
      return { animalId: h.animalId, weight: h.weight, amount: h.amount, costBasis: h.costBasis, eid: a.eid, visualTag: a.visualTag, category: a.category, status: a.status };
    });
  const money = can(ctx.role, "read_money");
  return { movement: money ? m : stripMoney(m), animals: money ? heads : heads.map((h) => ({ ...h, amount: null, costBasis: null })) };
}

/** Elimina un movimiento revirtiendo su efecto sobre los animales (solo owner/admin). */
export function deleteMovement(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "edit_movements", "Los movimientos confirmados solo puede eliminarlos un administrador.");
  const m = db.movements.find((x) => x.id === id && x.farmId === ctx.farm.id);
  if (!m) throw notFound("El movimiento no existe.");
  const ids = db.movementAnimals.filter((h) => h.movementId === m.id).map((h) => h.animalId);
  if (ids.length) {
    const idSet = new Set(ids);
    const movementById = new Map(db.movements.map((x) => [x.id, x]));
    const later = db.movementAnimals
      .filter((h) => idSet.has(h.animalId))
      .map((h) => movementById.get(h.movementId))
      .filter((x): x is MovementRow => !!x && x.farmId === ctx.farm.id);
    if (later.some((l) => l.id !== m.id && (l.date > m.date || (l.date === m.date && l.type !== m.type)))) {
      throw conflict("Hay movimientos posteriores sobre estos animales. Eliminalos primero.");
    }
    const reopen = () => {
      for (const ms of db.lotMemberships) if (ms.farmId === ctx.farm.id && idSet.has(ms.animalId) && ms.toDate === m.date) ms.toDate = null;
    };
    if (["venta", "muerte", "transferencia_campo"].includes(m.type)) {
      setAnimals(ids, { status: "activo" });
      reopen();
      if (m.type === "transferencia_campo" && m.toFarmId) {
        const copies = new Set(
          db.movementAnimals
            .filter((h) => {
              const mv = movementById.get(h.movementId);
              return mv && mv.farmId === m.toFarmId && mv.toFarmId === ctx.farm.id && mv.date === m.date && mv.type === "transferencia_campo";
            })
            .map((h) => h.animalId),
        );
        deleteAnimalsCascade(copies);
      }
    } else if (m.type === "transferencia_lote") {
      db.lotMemberships = db.lotMemberships.filter((ms) => ms.movementId !== m.id);
      reopen();
      if (m.fromLotId) setAnimals(ids, { currentLotId: m.fromLotId });
    } else if (m.type === "compra" || m.type === "nacimiento") {
      const createdIds = new Set(db.lotMemberships.filter((ms) => ms.movementId === m.id).map((ms) => ms.animalId));
      deleteAnimalsCascade(createdIds);
      const associated = ids.filter((i) => !createdIds.has(i));
      setAnimals(associated, { purchaseCost: null, purchaseDate: null, origin: "sin_dato" });
    }
  }
  db.movements = db.movements.filter((x) => x.id !== m.id);
  db.movementAnimals = db.movementAnimals.filter((h) => h.movementId !== m.id);
}

export type { MovementRow };

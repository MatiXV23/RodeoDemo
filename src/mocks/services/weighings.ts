// Pesadas: manual, promedio de lote, sesiones (port de apps/api/src/services/weighings.ts).

import { D, toDb, toNum, type Numeric } from "@rodeo/shared";
import { ABSOLUTE_WEIGHT_RANGE, WEIGHT_RANGES, type Category } from "@rodeo/shared";
import { isIsoDate, zonedToUtc } from "@rodeo/shared";
import { db, uuid, nowIso, deleteSessionCascade } from "../db";
import { assertCan, badRequest, notFound, type FarmCtx } from "../core";
import { getAnimalOrThrow, getLotOrThrow } from "./animals";
import type { WeighingRow, WeighingSessionRow } from "../schema";

export type WeighingRowInput = { animalId: string; lotId: string | null; weight: Numeric; date: string; time?: string | null; mode?: "lector" | "manual"; observation?: string | null; reliable?: boolean };

export function weighingInsertRows(ctx: FarmCtx, sessionId: string, rows: WeighingRowInput[]): WeighingRow[] {
  const now = nowIso();
  return rows.map((r) => ({
    id: uuid(),
    farmId: ctx.farm.id,
    sessionId,
    animalId: r.animalId,
    lotId: r.lotId,
    weight: toDb(r.weight, 2),
    weighedAt: zonedToUtc(r.date, r.time || "12:00:00", ctx.farm.timezone),
    date: r.date,
    mode: r.mode || "manual",
    observation: r.observation || null,
    reliable: r.reliable ?? r.mode !== "manual",
    createdAt: now,
  }));
}

export function newSession(ctx: FarmCtx, s: Partial<WeighingSessionRow> & { id: string; date: string; name: string; origin: string }): WeighingSessionRow {
  return { farmId: ctx.farm.id, fileKey: null, fileName: null, fileHash: null, rowsHash: null, notes: null, createdBy: ctx.user.id, createdAt: nowIso(), ...s };
}

export function manualWeighing(ctx: FarmCtx, input: { animal: string; weight: string | number; date?: string | null; time?: string | null; observation?: string | null; confirmAnomalous?: boolean }) {
  assertCan(ctx.role, "write_operational");
  const animal = getAnimalOrThrow(ctx, String(input.animal || "").trim());
  if (animal.status !== "activo") throw badRequest(`El animal figura como ${animal.status}; no se puede pesar.`);
  const weight = D(input.weight);
  if (!weight.isFinite() || weight.lt(ABSOLUTE_WEIGHT_RANGE[0]) || weight.gt(ABSOLUTE_WEIGHT_RANGE[1])) {
    throw badRequest(`El peso debe estar entre ${ABSOLUTE_WEIGHT_RANGE[0]} y ${ABSOLUTE_WEIGHT_RANGE[1]} kg.`);
  }
  const range = WEIGHT_RANGES[animal.category as Category];
  const anomalous = range ? weight.lt(range[0]) || weight.gt(range[1]) : false;
  if (anomalous && !input.confirmAnomalous) {
    throw badRequest(`El peso es poco habitual para ${animal.category} (${range[0]}–${range[1]} kg). Confirmá que es correcto.`, { code: "peso_anomalo" });
  }
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  if (date > ctx.today) throw badRequest("La fecha de la pesada no puede ser futura.");
  let session = db.weighingSessions.find((s) => s.farmId === ctx.farm.id && s.date === date && s.origin === "manual" && s.name === "Pesadas manuales");
  if (!session) {
    session = newSession(ctx, { id: uuid(), date, name: "Pesadas manuales", origin: "manual" });
    db.weighingSessions.push(session);
  }
  const rows = weighingInsertRows(ctx, session.id, [{ animalId: animal.id, lotId: animal.currentLotId, weight, date, time: input.time || null, mode: "manual", observation: input.observation || null, reliable: true }]);
  db.weighings.push(...rows);
  return { sessionId: session.id, weighing: rows[0], animal: { id: animal.id, eid: animal.eid, visualTag: animal.visualTag, lotId: animal.currentLotId }, anomalous };
}

export function lotAverageWeighing(ctx: FarmCtx, input: { lotId: string; date?: string | null; headCount: number; totalWeight: string | number; notes?: string | null }) {
  assertCan(ctx.role, "write_operational");
  const lot = getLotOrThrow(ctx, input.lotId);
  const heads = Math.floor(Number(input.headCount));
  const total = D(input.totalWeight);
  if (!heads || heads < 1) throw badRequest("Indicá la cantidad de animales pesados.");
  if (!total.isFinite() || total.lte(0)) throw badRequest("Indicá los kilos totales de la pesada.");
  const avg = total.div(heads);
  if (avg.lt(ABSOLUTE_WEIGHT_RANGE[0]) || avg.gt(ABSOLUTE_WEIGHT_RANGE[1])) throw badRequest("El peso promedio resultante no es razonable.");
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  const sessionId = uuid();
  const row = { id: uuid(), farmId: ctx.farm.id, sessionId, lotId: lot.id, date, headCount: heads, totalWeight: toDb(total, 2), createdAt: nowIso() };
  db.weighingSessions.push(newSession(ctx, { id: sessionId, date, name: `Pesada promedio · ${lot.name}`, origin: "promedio", notes: input.notes || null }));
  db.lotAverageWeighings.push(row);
  return { ...row, avgWeight: toNum(avg, 1) };
}

export function listSessions(ctx: FarmCtx) {
  const sessions = db.weighingSessions.filter((s) => s.farmId === ctx.farm.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const bySession = new Map<string, WeighingRow[]>();
  for (const w of db.weighings) if (w.farmId === ctx.farm.id) bySession.set(w.sessionId, [...(bySession.get(w.sessionId) || []), w]);
  return sessions.map((s) => {
    const ws = bySession.get(s.id) || [];
    const avgs = db.lotAverageWeighings.filter((a) => a.sessionId === s.id);
    const avgCount = avgs.reduce((n, a) => n + a.headCount, 0);
    const avgTotal = avgs.reduce((n, a) => n + Number(a.totalWeight), 0);
    const count = ws.length;
    return {
      ...s,
      count: count || avgCount || 0,
      avgWeight: count ? Math.round((ws.reduce((n, w) => n + Number(w.weight), 0) / count) * 10) / 10 : avgCount ? Math.round((avgTotal / avgCount) * 10) / 10 : null,
      lotIds: [...new Set([...ws.map((w) => w.lotId), ...avgs.map((a) => a.lotId)].filter((x): x is string => !!x))],
    };
  });
}

export function sessionDetail(ctx: FarmCtx, id: string) {
  const session = db.weighingSessions.find((s) => s.id === id && s.farmId === ctx.farm.id);
  if (!session) throw notFound("La sesión de pesada no existe.");
  const animalById = new Map(db.animals.map((a) => [a.id, a]));
  const lotById = new Map(db.lots.map((l) => [l.id, l]));
  const rows = db.weighings.filter((w) => w.sessionId === session.id).sort((a, b) => a.weighedAt.localeCompare(b.weighedAt));
  const averages = db.lotAverageWeighings.filter((a) => a.sessionId === session.id);
  const batch = db.importBatches.find((b) => b.sessionId === session.id);
  return {
    session,
    weighings: rows
      .filter((w) => animalById.has(w.animalId))
      .map((w) => {
        const a = animalById.get(w.animalId)!;
        return { ...w, weight: toNum(w.weight, 1), eid: a.eid, visualTag: a.visualTag, category: a.category, lotName: w.lotId ? lotById.get(w.lotId)?.name || null : null };
      }),
    averages: averages.map((r) => ({ ...r, totalWeight: toNum(r.totalWeight, 1), lotName: lotById.get(r.lotId)?.name || null })),
    importBatchId: batch?.id ?? null,
  };
}

export function deleteSession(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "edit_movements", "Solo un administrador puede eliminar sesiones de pesada.");
  const session = db.weighingSessions.find((s) => s.id === id && s.farmId === ctx.farm.id);
  if (!session) throw notFound("La sesión de pesada no existe.");
  deleteSessionCascade(session.id);
  for (const b of db.importBatches) if (b.sessionId === session.id) b.status = "descartada";
}

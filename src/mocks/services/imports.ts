// Importación de pesadas en tres pasos (port de apps/api/src/services/imports.ts).
// El archivo se lee en el navegador con el mismo parser del servidor.

import { isIsoDate } from "@rodeo/shared";
import { parseWeighingFile, validateRows, resolveRows, rowsFingerprint, type ParsedRow, type RowDecision } from "@rodeo/shared";
import { db, uuid, nowIso, putFile } from "../db";
import { assertCan, badRequest, conflict, notFound, type FarmCtx } from "../core";
import { getLotOrThrow, buildAnimalRows } from "./animals";
import { weighingInsertRows, newSession } from "./weighings";
import { contentTypeFor, hashHex, safeFileName } from "./files";
import type { ImportBatchRow, LotRow } from "../schema";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function uploadImport(ctx: FarmCtx, input: { fileName: string; bytes: Uint8Array }, options: { storeFile?: boolean } = {}) {
  assertCan(ctx.role, "write_operational");
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw badRequest("El archivo supera los 10 MB.");
  const fileName = safeFileName(input.fileName || "pesada.xlsx");
  let parsed;
  try {
    parsed = parseWeighingFile(input.bytes, fileName);
  } catch (e) {
    throw badRequest((e as Error).message || "No se pudo leer el archivo.");
  }
  const fileHash = hashHex(input.bytes);
  const rowsHash = hashHex(new TextEncoder().encode(rowsFingerprint(parsed.rows)));
  const id = uuid();
  const fileKey = `farms/${ctx.farm.id}/imports/${id}/${fileName}`;
  if (options.storeFile !== false) putFile(fileKey, input.bytes, contentTypeFor(fileName), fileName);
  db.importBatches.push({ id, farmId: ctx.farm.id, fileKey, fileName, fileHash, rowsHash, status: "pendiente", rows: parsed.rows, decisions: null, sessionId: null, createdBy: ctx.user.id, createdAt: nowIso(), confirmedAt: null });
  const preview = previewImport(ctx, id);
  return { ...preview, parseWarnings: parsed.warnings, sheetName: parsed.sheetName, columns: parsed.columns };
}

function loadBatch(ctx: FarmCtx, id: string) {
  const batch = db.importBatches.find((b) => b.id === id && b.farmId === ctx.farm.id);
  if (!batch) throw notFound("La importación no existe.");
  return batch;
}

function validationContext(ctx: FarmCtx, batch: ImportBatchRow, rows: ParsedRow[]) {
  const animalRows = db.animals.filter((a) => a.farmId === ctx.farm.id);
  const last = new Map<string, { weight: string; date: string; at: string }>();
  for (const w of db.weighings) {
    if (w.farmId !== ctx.farm.id) continue;
    const prev = last.get(w.animalId);
    if (!prev || w.weighedAt > prev.at) last.set(w.animalId, { weight: w.weight, date: w.date, at: w.weighedAt });
  }
  const known = new Map(animalRows.map((a) => [a.eid, { id: a.id, eid: a.eid, status: a.status, category: a.category, sex: a.sex, lotId: a.currentLotId, lastWeight: last.get(a.id)?.weight ?? null, lastDate: last.get(a.id)?.date ?? null }]));
  const freq = new Map<string, number>();
  for (const r of rows) if (r.date) freq.set(r.date, (freq.get(r.date) || 0) + 1);
  const sessionDate = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ctx.today;
  const sessions = db.weighingSessions.filter((s) => s.farmId === ctx.farm.id);
  return {
    ctx: {
      animals: known,
      sessionDate,
      fileHash: batch.fileHash,
      rowsHash: batch.rowsHash,
      previousFileHashes: new Set(sessions.map((s) => s.fileHash).filter((h): h is string => !!h)),
      previousRowsHashes: new Set(sessions.map((s) => s.rowsHash).filter((h): h is string => !!h)),
    },
    sessionDate,
  };
}

export function previewImport(ctx: FarmCtx, id: string) {
  const batch = loadBatch(ctx, id);
  const rows = batch.rows as ParsedRow[];
  const { ctx: vctx, sessionDate } = validationContext(ctx, batch, rows);
  const validation = validateRows(rows, vctx);
  const farmLots = db.lots.filter((l) => l.farmId === ctx.farm.id).map((l) => ({ id: l.id, name: l.name, category: l.category, status: l.status }));
  return { batchId: batch.id, status: batch.status, sessionId: batch.sessionId, fileName: batch.fileName, sessionDate, rows: validation.rows, summary: validation.summary, lots: farmLots };
}

export type ConfirmImportInput = { date?: string | null; name?: string | null; notes?: string | null; defaultLotId?: string | null; decisions?: RowDecision[]; acknowledgeDuplicateImport?: boolean };

export function confirmImport(ctx: FarmCtx, id: string, input: ConfirmImportInput) {
  assertCan(ctx.role, "write_operational");
  const batch = loadBatch(ctx, id);
  if (batch.status === "confirmada" && batch.sessionId) return { sessionId: batch.sessionId, alreadyConfirmed: true, created: 0, imported: 0, sexUpdated: 0 };
  if (batch.status === "descartada") throw conflict("La importación fue descartada.");
  const rows = batch.rows as ParsedRow[];
  const { ctx: vctx, sessionDate } = validationContext(ctx, batch, rows);
  const validation = validateRows(rows, vctx);
  if (validation.summary.alreadyImported && !input.acknowledgeDuplicateImport) {
    throw conflict("Este archivo ya fue importado. Confirmá que querés registrarlo de nuevo.", { code: "ya_importado" });
  }
  const date = input.date && isIsoDate(input.date) ? input.date : sessionDate;
  if (date > ctx.today) throw badRequest("La fecha de la sesión no puede ser futura.");
  const defaultLotId = input.defaultLotId || null;
  const { rows: resolved, errors } = resolveRows(validation.rows, input.decisions || [], defaultLotId);
  if (errors.length) throw badRequest("Hay filas sin resolver.", { code: "filas_sin_resolver", errors });
  const included = resolved.filter((r) => r.action === "include");
  const lotIds = [...new Set(included.map((r) => r.lotId).filter((l): l is string => !!l))];
  const lotById = new Map<string, LotRow>();
  for (const lotId of lotIds) lotById.set(lotId, getLotOrThrow(ctx, lotId));

  const sessionId = uuid();
  const newRows = included.filter((r) => r.isNew);
  const built = buildAnimalRows(
    ctx,
    newRows.map((r) => ({ eid: r.eid, lotId: r.lotId, category: r.category || lotById.get(r.lotId!)?.category || "otro", sex: r.sex, origin: "sin_dato", notes: r.observation })),
    { reason: "importacion", date, sessionId: null },
  );
  const idByEid = new Map(built.animalRows.map((a) => [a.eid, a.id]));
  const weighingRows = weighingInsertRows(
    ctx,
    sessionId,
    included.map((r) => ({ animalId: r.animalId || idByEid.get(r.eid)!, lotId: r.lotId, weight: r.weight!, date: r.date || date, time: r.time, mode: r.mode, observation: r.observation, reliable: r.mode !== "manual" })),
  );
  db.weighingSessions.push(
    newSession(ctx, { id: sessionId, date, name: input.name?.trim() || batch.fileName.replace(/\.(xlsx|csv|txt|tsv)$/i, ""), origin: "importada", fileKey: batch.fileKey, fileName: batch.fileName, fileHash: batch.fileHash, rowsHash: batch.rowsHash, notes: input.notes || null }),
  );
  db.animals.push(...built.animalRows);
  db.lotMemberships.push(...built.membershipRows);
  db.weighings.push(...weighingRows);
  const sexChanges = included.filter((r) => r.animalId && r.newSex);
  const updatedAt = nowIso();
  for (const r of sexChanges) {
    const a = db.animals.find((x) => x.id === r.animalId && x.farmId === ctx.farm.id);
    if (a) Object.assign(a, { sex: r.newSex!, updatedAt });
  }
  Object.assign(batch, { status: "confirmada", sessionId, decisions: input.decisions || [], confirmedAt: nowIso() });
  return { sessionId, alreadyConfirmed: false, imported: weighingRows.length, created: built.animalRows.length, discarded: resolved.length - included.length, sexUpdated: sexChanges.length };
}

export function discardImport(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "write_operational");
  const batch = loadBatch(ctx, id);
  if (batch.status === "confirmada") throw conflict("La importación ya fue confirmada.");
  batch.status = "descartada";
}

export function pendingImports(ctx: FarmCtx) {
  return db.importBatches
    .filter((b) => b.farmId === ctx.farm.id && b.status === "pendiente")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => ({ id: b.id, fileName: b.fileName, createdAt: b.createdAt, createdBy: b.createdBy }));
}

// Cola offline: aplica una sola vez cada operación cargada sin conexión
// (port de apps/api/src/services/sync.ts).

import { db, nowIso } from "../db";
import { HttpError, type FarmCtx } from "../core";
import { manualWeighing } from "./weighings";
import { createExpense, type ExpenseInput } from "./expenses";
import { createHealthEvent, type HealthInput } from "./health";

export type SyncOp =
  | { clientId: string; kind: "manual_weighing"; at: string; payload: Parameters<typeof manualWeighing>[1] }
  | { clientId: string; kind: "expense"; at: string; payload: ExpenseInput }
  | { clientId: string; kind: "health_event"; at: string; payload: HealthInput };

export type SyncResult = { clientId: string; status: "ok" | "conflicto" | "error" | "duplicado"; message?: string; result?: unknown };

export function applySyncOps(ctx: FarmCtx, ops: SyncOp[]): SyncResult[] {
  const doneById = new Map(db.syncOps.map((d) => [d.clientId, d]));
  const results: SyncResult[] = [];
  for (const op of ops) {
    if (!op.clientId) {
      results.push({ clientId: "", status: "error", message: "Falta clientId." });
      continue;
    }
    const prev = doneById.get(op.clientId);
    if (prev) {
      results.push({ clientId: op.clientId, status: "duplicado", message: "Ya se había aplicado.", result: prev.result });
      continue;
    }
    let r: SyncResult;
    try {
      let result: unknown;
      const date = op.at ? op.at.slice(0, 10) : undefined;
      if (op.kind === "manual_weighing") result = manualWeighing(ctx, { ...op.payload, date: op.payload.date || date });
      else if (op.kind === "expense") result = createExpense(ctx, { ...op.payload, date: op.payload.date || date });
      else if (op.kind === "health_event") result = createHealthEvent(ctx, { ...op.payload, date: op.payload.date || date });
      else throw new HttpError(400, "Tipo de operación desconocido.");
      r = { clientId: op.clientId, status: "ok", result };
    } catch (e) {
      const err = e as HttpError;
      const conflict = err instanceof HttpError && (err.status === 409 || err.status === 404 || /no está activo|activo|cerrado|figura como/.test(err.message));
      r = { clientId: op.clientId, status: conflict ? "conflicto" : "error", message: err.message || "Error al aplicar la operación." };
    }
    db.syncOps.push({ clientId: op.clientId, farmId: ctx.farm.id, userId: ctx.user.id, kind: op.kind, status: r.status, result: r.result ? { ok: true } : { message: r.message }, createdAt: nowIso() });
    results.push(r);
  }
  return results;
}

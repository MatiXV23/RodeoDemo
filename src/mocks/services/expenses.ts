// Gastos con imputación a lotes o al campo (port de apps/api/src/services/expenses.ts).

import { D, sum, toDb, money2, toNum } from "@rodeo/shared";
import { EXPENSE_CATEGORIES, PASTURE_SUBTYPES } from "@rodeo/shared";
import { isIsoDate } from "@rodeo/shared";
import { db, uuid, nowIso, putFile, deleteExpenseCascade } from "../db";
import { assertCan, can, badRequest, notFound, type FarmCtx } from "../core";
import { contentTypeFor, safeFileName } from "./files";

export type AllocationInput = { lotId: string | null; percentage?: number | string };

export type ExpenseInput = {
  category: string;
  subcategory?: string | null;
  description: string;
  supplier?: string | null;
  date?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unitPrice?: number | string | null;
  total?: number | string | null;
  currency?: string | null;
  notes?: string | null;
  allocations?: AllocationInput[];
  receipt?: { fileName: string; bytes: Uint8Array } | null;
};

function normalizeAllocations(input: AllocationInput[] | undefined) {
  const list = (input || []).filter((a) => a.lotId);
  if (!list.length) return [{ lotId: null as string | null, percentage: "100" }];
  const withPct = list.filter((a) => a.percentage !== undefined && a.percentage !== null && a.percentage !== "");
  let result: { lotId: string | null; percentage: string }[];
  if (withPct.length === list.length) {
    result = list.map((a) => ({ lotId: a.lotId, percentage: toDb(a.percentage!, 4) }));
    const total = sum(result.map((r) => r.percentage));
    if (!total.equals(100)) throw badRequest(`Los porcentajes deben sumar 100 (suman ${total.toFixed(2)}).`);
  } else {
    const each = D(100).div(list.length).toDecimalPlaces(4, 1);
    result = list.map((a) => ({ lotId: a.lotId, percentage: each.toFixed() }));
    const diff = D(100).minus(sum(result.map((r) => r.percentage)));
    result[0].percentage = each.plus(diff).toFixed();
  }
  if (new Set(result.map((r) => r.lotId)).size !== result.length) throw badRequest("Hay lotes repetidos en la imputación.");
  return result;
}

function validateExpense(ctx: FarmCtx, input: ExpenseInput) {
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category)) throw badRequest("Categoría de gasto no válida.");
  const subcategory = input.category === "pasturas" && input.subcategory && (PASTURE_SUBTYPES as readonly string[]).includes(input.subcategory) ? input.subcategory : null;
  if (!input.description?.trim()) throw badRequest("Ingresá una descripción del gasto.");
  const quantity = input.quantity !== null && input.quantity !== undefined && input.quantity !== "" ? D(input.quantity) : null;
  const unitPrice = input.unitPrice !== null && input.unitPrice !== undefined && input.unitPrice !== "" ? D(input.unitPrice) : null;
  let total = input.total !== null && input.total !== undefined && input.total !== "" ? D(input.total) : null;
  if (!total && quantity && unitPrice) total = quantity.times(unitPrice);
  if (!total || !total.isFinite() || total.lte(0)) throw badRequest("Ingresá el importe total del gasto.");
  const date = input.date && isIsoDate(input.date) ? input.date : ctx.today;
  const allocations = normalizeAllocations(input.allocations);
  const lotIds = allocations.map((a) => a.lotId).filter((l): l is string => !!l);
  if (lotIds.length && lotIds.some((id) => !db.lots.some((l) => l.id === id && l.farmId === ctx.farm.id))) throw notFound("Alguno de los lotes no existe en este campo.");
  return { subcategory, quantity, unitPrice, total, date, allocations };
}

export function createExpense(ctx: FarmCtx, input: ExpenseInput) {
  assertCan(ctx.role, "write_operational");
  const v = validateExpense(ctx, input);
  const id = uuid();
  let receiptKey: string | null = null;
  let receiptName: string | null = null;
  if (input.receipt) {
    receiptName = safeFileName(input.receipt.fileName);
    receiptKey = `farms/${ctx.farm.id}/receipts/${id}/${receiptName}`;
    putFile(receiptKey, input.receipt.bytes, contentTypeFor(receiptName), receiptName);
  }
  const now = nowIso();
  db.expenses.push({
    id,
    farmId: ctx.farm.id,
    category: input.category,
    subcategory: v.subcategory,
    description: input.description.trim(),
    supplier: input.supplier?.trim() || null,
    date: v.date,
    quantity: v.quantity ? toDb(v.quantity, 3) : null,
    unit: input.unit?.trim() || null,
    unitPrice: v.unitPrice ? toDb(v.unitPrice, 4) : null,
    total: money2(v.total),
    currency: (input.currency || ctx.farm.currency).toUpperCase(),
    receiptKey,
    receiptName,
    notes: input.notes?.trim() || null,
    createdBy: ctx.user.id,
    createdAt: now,
    updatedAt: now,
  });
  db.expenseAllocations.push(...v.allocations.map((a) => ({ id: uuid(), farmId: ctx.farm.id, expenseId: id, lotId: a.lotId, percentage: a.percentage })));
  return expenseDetail(ctx, id);
}

export function deleteExpense(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "write_money", "Solo un administrador puede eliminar gastos.");
  const current = db.expenses.find((e) => e.id === id && e.farmId === ctx.farm.id);
  if (!current) throw notFound("El gasto no existe.");
  deleteExpenseCascade(id);
}

export function listExpenses(ctx: FarmCtx) {
  const rows = db.expenses.filter((e) => e.farmId === ctx.farm.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const byExpense = new Map<string, { lotId: string | null; percentage: number }[]>();
  for (const a of db.expenseAllocations) if (a.farmId === ctx.farm.id) byExpense.set(a.expenseId, [...(byExpense.get(a.expenseId) || []), { lotId: a.lotId, percentage: toNum(a.percentage, 2) }]);
  const money = can(ctx.role, "read_money");
  return rows.map((e) => ({ ...e, total: money ? e.total : null, unitPrice: money ? e.unitPrice : null, allocations: byExpense.get(e.id) || [] }));
}

export function expenseDetail(ctx: FarmCtx, id: string) {
  const e = db.expenses.find((x) => x.id === id && x.farmId === ctx.farm.id);
  if (!e) throw notFound("El gasto no existe.");
  const money = can(ctx.role, "read_money");
  const allocs = db.expenseAllocations.filter((a) => a.expenseId === id).map((a) => ({ lotId: a.lotId, percentage: toNum(a.percentage, 2) }));
  return { ...e, total: money ? e.total : null, unitPrice: money ? e.unitPrice : null, allocations: allocs };
}

// Precios de referencia (port de apps/api/src/services/prices.ts).
// Solo los precios en pie valúan lotes; los de 4ta balanza (ACG gordo) se grafican.

import { D, toDb, toNum } from "@rodeo/shared";
import { CATEGORIES, parseCategory, normalizeHeader, type Category } from "@rodeo/shared";
import { isIsoDate, parseReaderDate } from "@rodeo/shared";
import { parseCsv } from "@rodeo/shared";
import { db, uuid, nowIso } from "../db";
import { assertCan, badRequest, notFound, type FarmCtx } from "../core";
import type { MarketPriceRow } from "../schema";

export type PriceBasis = "en_pie" | "cuarta_balanza";
export const parseBasis = (v: unknown): PriceBasis => (v === "cuarta_balanza" ? "cuarta_balanza" : "en_pie");

export type PriceInput = { date?: string | null; category: string; pricePerKg: string | number; currency?: string | null; source?: string | null; provider?: string | null; basis?: string | null };

export function addPrice(ctx: FarmCtx, input: PriceInput) {
  assertCan(ctx.role, "write_money");
  const price = D(input.pricePerKg);
  if (!price.isFinite() || price.lte(0)) throw badRequest("Ingresá un precio por kg válido.");
  const row: MarketPriceRow = {
    id: uuid(),
    farmId: ctx.farm.id,
    date: input.date && isIsoDate(input.date) ? input.date : ctx.today,
    category: parseCategory(input.category),
    pricePerKg: toDb(price, 4),
    currency: (input.currency || ctx.farm.currency).toUpperCase(),
    source: input.source === "api" ? "api" : input.source === "csv" ? "csv" : "manual",
    provider: input.provider?.trim() || null,
    basis: parseBasis(input.basis),
    createdAt: nowIso(),
  };
  db.marketPrices.push(row);
  return row;
}

export function deletePrice(ctx: FarmCtx, id: string) {
  assertCan(ctx.role, "write_money");
  if (!db.marketPrices.some((p) => p.id === id && p.farmId === ctx.farm.id)) throw notFound("El precio no existe.");
  db.marketPrices = db.marketPrices.filter((p) => p.id !== id);
}

const byDateDesc = (a: MarketPriceRow, b: MarketPriceRow) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

export function listPrices(ctx: FarmCtx, limit = 500) {
  assertCan(ctx.role, "read_money");
  return db.marketPrices.filter((p) => p.farmId === ctx.farm.id).sort(byDateDesc).slice(0, limit);
}

export type LatestPrices = Partial<Record<Category, { pricePerKg: string; date: string; source: string; currency: string }>>;

/** Último precio en pie vigente por categoría a una fecha. */
export function latestPrices(ctx: FarmCtx, asOf?: string): LatestPrices {
  const date = asOf && isIsoDate(asOf) ? asOf : ctx.today;
  const rows = db.marketPrices.filter((p) => p.farmId === ctx.farm.id && p.basis === "en_pie").sort(byDateDesc);
  const out: LatestPrices = {};
  for (const r of rows) {
    if (r.date > date) continue;
    const c = r.category as Category;
    if (!out[c]) out[c] = { pricePerKg: r.pricePerKg, date: r.date, source: r.source, currency: r.currency };
  }
  return out;
}

export function priceFor(prices: LatestPrices, category: string) {
  const p = prices[parseCategory(category)];
  return p ? { price: D(p.pricePerKg), date: p.date, source: p.source } : null;
}

/** Importador CSV: columnas fecha, categoria, precio (y opcional moneda). */
export function importPricesCsv(ctx: FarmCtx, text: string, provider?: string | null) {
  assertCan(ctx.role, "write_money");
  const table = parseCsv(text);
  if (table.length < 2) throw badRequest("El archivo no tiene filas.");
  const header = table[0].map((h) => normalizeHeader(h));
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const dateCol = col(["fecha", "date"]);
  const catCol = col(["categoria", "category", "cat"]);
  const priceCol = col(["precio", "precio kg", "precio por kg", "price", "usd kg", "price per kg"]);
  const curCol = col(["moneda", "currency"]);
  if (dateCol < 0 || catCol < 0 || priceCol < 0) throw badRequest("Se esperan las columnas fecha, categoría y precio.");
  const rows: MarketPriceRow[] = [];
  const errors: string[] = [];
  table.slice(1).forEach((r, i) => {
    const d = parseReaderDate(r[dateCol]);
    const price = D(String(r[priceCol] || "").replace(",", "."));
    const category = parseCategory(r[catCol]);
    if (!d) errors.push(`Fila ${i + 2}: fecha inválida.`);
    else if (!price.isFinite() || price.lte(0)) errors.push(`Fila ${i + 2}: precio inválido.`);
    else if (!(CATEGORIES as readonly string[]).includes(category) || (category === "otro" && normalizeHeader(String(r[catCol])) !== "otro")) errors.push(`Fila ${i + 2}: categoría desconocida (${r[catCol]}).`);
    else rows.push({ id: uuid(), farmId: ctx.farm.id, date: d.date, category, pricePerKg: toDb(price, 4), currency: (r[curCol] || ctx.farm.currency).toUpperCase(), source: "csv", provider: provider || null, basis: "en_pie", createdAt: nowIso() });
  });
  if (errors.length) throw badRequest("El archivo tiene errores.", { errors });
  db.marketPrices.push(...rows);
  return { imported: rows.length };
}

export function priceSummary(rows: MarketPriceRow[]) {
  return rows.map((r) => ({ ...r, pricePerKg: toNum(r.pricePerKg, 4) }));
}

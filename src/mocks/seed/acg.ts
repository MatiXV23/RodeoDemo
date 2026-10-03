// Planificador simulado de precios ACG. En la app real un proceso del servidor
// baja la portada de acg.com.uy los lunes desde las 22:00 (Montevideo) y carga
// la semana en todos los campos. En la demo se generan cotizaciones verosímiles
// con la misma regla de calendario, sin intervención del usuario.

import { addDays } from "@rodeo/shared";
import { db, uuid, nowIso } from "../db";
import { ACG_WEEK } from "./catalog";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TZ = "America/Montevideo";
const PUBLISH_HOUR = 22;

function localParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(get("weekday")), hour: Number(get("hour")) % 24, date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Lunes de la última semana ACG que ya debería estar publicada (igual que en el servidor). */
export function expectedWeekEnd(now: Date = new Date()) {
  const local = localParts(now);
  let back = (local.weekday - 1 + 7) % 7;
  if (back === 0 && local.hour < PUBLISH_HOUR) back = 7;
  const [y, m, d] = local.date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
}

// Variación semanal determinista por fecha (los precios no "saltan" al recargar).
function wiggle(date: string, key: string) {
  let h = 2166136261;
  for (const c of date + key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.03; // ±1,5 %
}

export function acgRows(farmId: string, weekEnd: string, factor: number) {
  return ACG_WEEK.map((q) => ({
    id: uuid(),
    farmId,
    date: weekEnd,
    category: q.category,
    pricePerKg: (q.price * factor * (1 + wiggle(weekEnd, q.category + q.basis))).toFixed(4),
    currency: "USD",
    source: "api",
    provider: "ACG",
    basis: q.basis,
    createdAt: nowIso(),
  }));
}

/** Serie histórica para el seed: `weeks` semanas hasta la última publicada, con leve suba en el tiempo. */
export function seedAcgHistory(farmId: string, weeks = 14) {
  const last = expectedWeekEnd();
  for (let w = weeks - 1; w >= 0; w--) db.marketPrices.push(...acgRows(farmId, addDays(last, -7 * w), 1 - 0.0045 * w));
}

/**
 * Corrida del planificador: carga en cada campo las semanas publicadas que falten.
 * Devuelve la última semana cargada (o null si no había nada nuevo).
 */
export function runAcgScheduler(now: Date = new Date()) {
  const expected = expectedWeekEnd(now);
  let loaded: { weekEnd: string; weeks: number } | null = null;
  for (const farm of db.farms) {
    const acg = db.marketPrices.filter((p) => p.farmId === farm.id && p.provider === "ACG");
    // Un campo sin precios de ACG (recién creado) recibe la última semana publicada.
    let latest = acg.reduce((max, p) => (p.date > max ? p.date : max), "") || addDays(expected, -7);
    let weeks = 0;
    while (latest < expected && weeks < 12) {
      latest = addDays(latest, 7);
      db.marketPrices.push(...acgRows(farm.id, latest, 1));
      weeks++;
    }
    if (weeks) loaded = { weekEnd: latest, weeks };
  }
  return loaded;
}

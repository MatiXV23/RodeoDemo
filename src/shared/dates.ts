// Utilidades de fechas. En base todo se guarda en UTC (ISO 8601) y las fechas
// "de negocio" (YYYY-MM-DD) se interpretan en la zona horaria del campo.

export const DAY_MS = 86400000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

/** Suma días a una fecha YYYY-MM-DD (aritmética en UTC, sin efectos de DST). */
export function addDays(date: string, days: number) {
  const t = Date.parse(date + "T00:00:00Z") + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Días enteros entre dos fechas YYYY-MM-DD (b - a). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);
}

function partsIn(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

/** Fecha YYYY-MM-DD de un instante en una zona horaria. */
export function dateInZone(instant: Date | string, timeZone: string) {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const p = partsIn(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function todayIn(timeZone: string, now: Date = new Date()) {
  return dateInZone(now, timeZone);
}

/** Convierte una fecha/hora "de pared" en una zona horaria a ISO UTC. */
export function zonedToUtc(
  date: string,
  time: string | null | undefined,
  timeZone: string,
): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh = 0, mm = 0, ss = 0] = (time || "00:00:00").split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Dos iteraciones alcanzan para converger incluso en cambios de horario.
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(y, m - 1, d, hh, mm, ss) - asUtc;
  }
  return new Date(guess).toISOString();
}

export type ParsedDateTime = { date: string; time: string | null };

/**
 * Interpreta la fecha del lector y otros formatos habituales, siempre con el
 * día primero: `18/9/2026, 09:02:49`, `18/09/2026 9:02`, `2026-09-18`,
 * `2026-09-18T09:02:49`, o un `Date` (serial de Excel ya convertido).
 */
export function parseReaderDate(value: unknown, timeZone?: string): ParsedDateTime | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Los seriales de Excel llegan como UTC "de pared"; se conservan tal cual.
    const iso = value.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
  }
  if (typeof value === "number") return null;
  const s = String(value ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[,\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const month = Number(m[2]);
    const day = Number(m[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return {
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}:${m[6] || "00"}` : null,
    };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return {
      date: `${m[1]}-${m[2]}-${m[3]}`,
      time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}:${m[6] || "00"}` : null,
    };
  }
  void timeZone;
  return null;
}

export function nowIso() {
  return new Date().toISOString();
}

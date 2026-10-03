import { addDays, daysBetween } from "../dates";
import { GESTATION_DAYS, type ReproType } from "../domain";

export type ReproEventLite = { id?: string; type: ReproType | string; date: string; months?: number | null; bullId?: string | null; createdAt?: string };

export type ReproState = {
  pregnant: boolean;
  /** Meses de gestación estimados a la fecha de consulta (si está preñada). */
  months: number | null;
  /** Fecha del último diagnóstico de preñez. */
  checkedAt: string | null;
  /** Parto estimado = fecha del diagnóstico + (gestación − meses transcurridos). */
  expectedCalving: string | null;
  /** Días hasta el parto estimado (negativo si ya pasó). */
  daysToCalving: number | null;
  /** En entore sin diagnóstico posterior. */
  inService: boolean;
  serviceSince: string | null;
  /** Toro del último entore vigente (o el del entore previo a la preñez). */
  bullId: string | null;
  lastCalving: string | null;
  lastEventType: string | null;
  lastEventDate: string | null;
};

const DAYS_PER_MONTH = 30.4;

/** Parto estimado a partir del diagnóstico: quedan (283 − meses·30,4) días. */
export function expectedCalvingDate(checkedAt: string, months: number) {
  const elapsed = Math.round(Math.max(0, Math.min(9, months)) * DAYS_PER_MONTH);
  return addDays(checkedAt, Math.max(0, GESTATION_DAYS - elapsed));
}

/** Meses de gestación a una fecha dada, partiendo del diagnóstico. */
export function gestationMonthsAt(checkedAt: string, months: number, asOf: string) {
  return Math.min(9, Math.max(0, Math.round((months + daysBetween(checkedAt, asOf) / DAYS_PER_MONTH) * 10) / 10));
}

const order = (e: ReproEventLite) => e.date + (e.createdAt || "");

/**
 * Estado reproductivo actual a partir del historial de eventos.
 * Reglas: el último diagnóstico (preñez / vacía / parto) define si está
 * preñada; un entore posterior a ese diagnóstico la deja "en entore".
 */
export function reproState(events: ReproEventLite[], asOf: string): ReproState {
  const sorted = [...events].sort((a, b) => order(a).localeCompare(order(b)));
  const empty: ReproState = { pregnant: false, months: null, checkedAt: null, expectedCalving: null, daysToCalving: null, inService: false, serviceSince: null, bullId: null, lastCalving: null, lastEventType: null, lastEventDate: null };
  if (!sorted.length) return empty;
  const last = sorted[sorted.length - 1];
  const lastDiagnosis = [...sorted].reverse().find((e) => e.type !== "entore") || null;
  const lastService = [...sorted].reverse().find((e) => e.type === "entore") || null;
  const lastCalving = [...sorted].reverse().find((e) => e.type === "parto")?.date || null;
  const state: ReproState = { ...empty, lastCalving, lastEventType: last.type, lastEventDate: last.date };
  if (lastDiagnosis?.type === "prenez") {
    const months = Number(lastDiagnosis.months ?? 0);
    state.pregnant = true;
    state.checkedAt = lastDiagnosis.date;
    state.months = gestationMonthsAt(lastDiagnosis.date, months, asOf);
    state.expectedCalving = expectedCalvingDate(lastDiagnosis.date, months);
    state.daysToCalving = daysBetween(asOf, state.expectedCalving);
    // El toro es el del entore previo al diagnóstico, si lo hubo.
    const serviceBefore = [...sorted].reverse().find((e) => e.type === "entore" && order(e) <= order(lastDiagnosis));
    state.bullId = serviceBefore?.bullId || null;
  }
  if (lastService && (!lastDiagnosis || order(lastService) > order(lastDiagnosis))) {
    state.inService = true;
    state.serviceSince = lastService.date;
    state.bullId = lastService.bullId || null;
  }
  return state;
}

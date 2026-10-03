// Alertas del campo y resumen por correo (port de apps/api/src/services/alerts.ts).

import { D, toNum } from "@rodeo/shared";
import { addDays, daysBetween } from "@rodeo/shared";
import type { Alert } from "@rodeo/shared";
import { db } from "../db";
import { can, type FarmCtx } from "../core";
import { loadFarmMetrics, type FarmMetrics } from "./metrics";
import { activeWithdrawals, listReminders } from "./health";
import { pendingImports } from "./imports";
import { reproStates } from "./owners";
import { sendMail } from "./mail";

export function computeAlerts(ctx: FarmCtx, metricsIn?: FarmMetrics): Alert[] {
  const metrics = metricsIn || loadFarmMetrics(ctx);
  const cfg = ctx.farm.alertConfig;
  const today = metrics.asOf;
  const alerts: Alert[] = [];

  for (const m of metrics.lots.values()) {
    if (m.lot.status !== "activo" || !m.headCount) continue;
    const stale = m.animalIds.filter((id) => {
      const a = metrics.animals.get(id)!;
      return !a.lastDate || daysBetween(a.lastDate, today) > cfg.staleDays;
    });
    if (stale.length) {
      const days = m.lastWeighingDate ? daysBetween(m.lastWeighingDate, today) : null;
      alerts.push({
        id: `stale-${m.lot.id}`,
        type: "sin_pesar",
        severity: "warning",
        title: "Es hora de una pesada",
        description: stale.length === m.headCount ? `${m.lot.name} lleva ${days ?? "más de " + cfg.staleDays} días sin un registro de peso.` : `${stale.length} de ${m.headCount} animales de ${m.lot.name} llevan más de ${cfg.staleDays} días sin pesarse.`,
        lotId: m.lot.id,
      });
    }
    if (m.lot.targetWeight && m.avgWeight) {
      const target = D(m.lot.targetWeight);
      if (m.avgWeight.gte(target)) {
        alerts.push({ id: `target-${m.lot.id}`, type: "peso_objetivo", severity: "success", title: "Peso objetivo alcanzado", description: `${m.lot.name} alcanzó su objetivo de ${toNum(target, 0)} kg (promedio ${toNum(m.avgWeight, 0)} kg).`, lotId: m.lot.id });
      } else if (m.avgWeight.gte(target.times("0.95"))) {
        alerts.push({ id: `target-near-${m.lot.id}`, type: "peso_objetivo", severity: "info", title: "Cerca del peso objetivo", description: `${m.lot.name} está a ${toNum(target.minus(m.avgWeight), 0)} kg de su objetivo.`, lotId: m.lot.id });
      }
    }
  }

  const withdrawals = activeWithdrawals(ctx, today);
  const byLot = new Map<string, { count: number; until: string; product: string; lotId: string | null }>();
  for (const w of withdrawals) {
    const key = `${w.lotId || "sin-lote"}|${w.until}`;
    const cur = byLot.get(key) || { count: 0, until: w.until!, product: w.product, lotId: w.lotId };
    cur.count++;
    byLot.set(key, cur);
  }
  const soon = addDays(today, cfg.withdrawalSoonDays);
  for (const [key, w] of byLot) {
    const lotName = w.lotId ? metrics.lots.get(w.lotId)?.lot.name || "Lote" : "Animales";
    const ending = w.until <= soon;
    alerts.push({
      id: `withdrawal-${key}`,
      type: ending ? "retiro_por_vencer" : "retiro_vigente",
      severity: ending ? "info" : "warning",
      title: ending ? "Retiro sanitario por vencer" : "Período de retiro activo",
      description: `${w.count} animales de ${lotName} (${w.product}) ${ending ? "quedan habilitados" : "no aptos para venta hasta"} el ${w.until}.`,
      lotId: w.lotId,
      date: w.until,
    });
  }

  for (const b of pendingImports(ctx)) {
    alerts.push({ id: `import-${b.id}`, type: "importacion_pendiente", severity: "warning", title: "Importación sin confirmar", description: `El archivo ${b.fileName} quedó a medio importar. Revisá sus filas y confirmá o descartá la sesión.`, entityId: b.id, date: b.createdAt.slice(0, 10) });
  }

  for (const r of listReminders(ctx)) {
    if (r.dueDate > addDays(today, 7)) continue;
    const overdue = r.dueDate < today;
    alerts.push({ id: `reminder-${r.id}`, type: "recordatorio", severity: overdue ? "warning" : "info", title: overdue ? "Recordatorio vencido" : "Recordatorio sanitario", description: `${r.title}${r.lotName ? ` · ${r.lotName}` : ""} · ${r.dueDate}`, lotId: r.lotId, entityId: r.id, date: r.dueDate });
  }

  const calvingDays = cfg.calvingSoonDays ?? 30;
  for (const [animalId, st] of reproStates(ctx, today)) {
    const a = metrics.animals.get(animalId);
    if (!a || a.animal.status !== "activo") continue;
    if (st.pregnant && st.daysToCalving !== null && st.daysToCalving <= calvingDays) {
      const past = st.daysToCalving < 0;
      alerts.push({ id: `calving-${animalId}`, type: "parto_proximo", severity: past ? "warning" : "info", title: past ? "Parto estimado vencido" : "Parto próximo", description: `${a.animal.eid}: parto estimado el ${st.expectedCalving}${past ? " (sin registrar)" : ` · en ${st.daysToCalving} días`}.`, animalId, lotId: a.animal.currentLotId, date: st.expectedCalving });
    }
    if (st.inService && st.serviceSince && daysBetween(st.serviceSince, today) > 120) {
      alerts.push({ id: `service-${animalId}`, type: "entore_sin_diagnostico", severity: "info", title: "Entore sin diagnóstico", description: `${a.animal.eid} está en entore desde ${st.serviceSince} sin diagnóstico de preñez.`, animalId, lotId: a.animal.currentLotId, date: st.serviceSince });
    }
  }
  const order = { warning: 0, info: 1, success: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Envía (simulado) el resumen de alertas a los miembros del campo. */
export function emailAlertsDigest(ctx: FarmCtx) {
  if (!ctx.farm.alertConfig.email) return { sent: 0, reason: "deshabilitado" };
  const alerts = computeAlerts(ctx);
  if (!alerts.length) return { sent: 0, reason: "sin alertas" };
  const members = db.farmMembers.filter((m) => m.farmId === ctx.farm.id).map((m) => ({ role: m.role, email: db.users.find((u) => u.id === m.userId)?.email })).filter((m) => m.email);
  const text = alerts.map((a) => `• ${a.title}: ${a.description}`).join("\n");
  let sent = 0;
  for (const m of members) {
    if (!can(m.role, "read")) continue;
    sendMail({ to: m.email!, subject: `Rodeo · ${alerts.length} alerta(s) en ${ctx.farm.name}`, text: `Alertas del campo ${ctx.farm.name}:\n\n${text}`, kind: "alertas" });
    sent++;
  }
  return { sent, alerts: alerts.length };
}

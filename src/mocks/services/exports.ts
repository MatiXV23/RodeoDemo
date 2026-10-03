// Exportaciones a Excel e informe imprimible del lote (port de apps/api/src/services/exports.ts).
// El .xlsx se genera de verdad en el navegador con el mismo escritor del servidor.

import { toNum } from "@rodeo/shared";
import { CATEGORY_LABELS, MOVEMENT_LABELS, EXPENSE_CATEGORY_LABELS, type Category, type MovementType, type ExpenseCategory } from "@rodeo/shared";
import { writeWorkbook, toCsv, type CellValue } from "@rodeo/shared";
import { db } from "../db";
import { assertCan, badRequest, can, type FarmCtx } from "../core";
import { loadFarmMetrics } from "./metrics";
import { listExpenses } from "./expenses";
import { listMovements } from "./movements";
import { compareLots } from "./analytics";
import { reproStates } from "./owners";

export type ExportKind = "animales" | "pesadas" | "movimientos" | "gastos" | "lotes";

function rowsFor(ctx: FarmCtx, kind: ExportKind): { name: string; rows: CellValue[][] } {
  const money = can(ctx.role, "read_money");
  const lotName = new Map(db.lots.filter((l) => l.farmId === ctx.farm.id).map((l) => [l.id, l.name]));
  if (kind === "animales") {
    const metrics = loadFarmMetrics(ctx);
    const ownerById = new Map(db.owners.filter((o) => o.farmId === ctx.farm.id).map((o) => [o.id, o]));
    const repro = reproStates(ctx, metrics.asOf);
    const eidById = new Map([...metrics.animals.values()].map((m) => [m.animal.id, m.animal.eid]));
    const header = ["Caravana", "Visual", "Categoría", "Sexo", "Raza", "Origen", "Estado", "Lote", "Propietario", "DICOSE", "Prenda bancaria", "Referencia prenda", "Prendado desde", "Preñada", "Meses gestación", "Parto estimado", "En entore desde", "Toro", "Último parto", "Último peso (kg)", "Última pesada", "GDP (kg/día)", "Días en el lote", "Retiro hasta"];
    if (money) header.push("Costo de compra", "Costo acumulado");
    const rows = [...metrics.animals.values()].map((m) => {
      const o = m.animal.ownerId ? ownerById.get(m.animal.ownerId) : null;
      const st = repro.get(m.animal.id);
      const r: CellValue[] = [
        m.animal.eid,
        m.animal.visualTag,
        CATEGORY_LABELS[m.animal.category as Category] || m.animal.category,
        m.animal.sex,
        m.animal.breed,
        m.animal.origin,
        m.animal.status,
        m.animal.currentLotId ? lotName.get(m.animal.currentLotId) || "" : "",
        o?.name || "",
        o?.dicose || "",
        m.animal.pledgedBank || "",
        m.animal.pledgedRef || "",
        m.animal.pledgedSince,
        st?.pregnant ? "Sí" : "",
        st?.pregnant ? st.months : null,
        st?.expectedCalving || null,
        st?.inService ? st.serviceSince : null,
        st?.bullId ? eidById.get(st.bullId) || "" : "",
        st?.lastCalving || null,
        m.lastWeight ? toNum(m.lastWeight, 1) : null,
        m.lastDate,
        m.gdp.periodGdp ? toNum(m.gdp.periodGdp, 3) : null,
        m.daysInCurrentLot,
        m.withdrawalUntil,
      ];
      if (money) r.push(m.animal.purchaseCost ? toNum(m.animal.purchaseCost) : null, toNum(m.accumulatedCost));
      return r;
    });
    return { name: "Animales", rows: [header, ...rows] };
  }
  if (kind === "pesadas") {
    const animalById = new Map(db.animals.map((a) => [a.id, a]));
    const sessionById = new Map(db.weighingSessions.map((s) => [s.id, s]));
    const rows = db.weighings.filter((w) => w.farmId === ctx.farm.id && animalById.has(w.animalId) && sessionById.has(w.sessionId)).sort((a, b) => b.weighedAt.localeCompare(a.weighedAt));
    return {
      name: "Pesadas",
      rows: [
        ["Fecha", "Hora (UTC)", "Caravana", "Visual", "Peso (kg)", "Lote", "Sesión", "Origen", "Modo", "Confiable", "Observación"],
        ...rows.map((w) => {
          const a = animalById.get(w.animalId)!;
          const s = sessionById.get(w.sessionId)!;
          return [w.date, w.weighedAt.slice(11, 19), a.eid, a.visualTag, toNum(w.weight, 1), w.lotId ? lotName.get(w.lotId) || "" : "", s.name, s.origin, w.mode, w.reliable ? "sí" : "no", w.observation] as CellValue[];
        }),
      ],
    };
  }
  if (kind === "movimientos") {
    const rows = listMovements(ctx);
    const header = ["Fecha", "Tipo", "Contraparte", "Cabezas", "Peso total (kg)", "Lote origen", "Lote destino", "Documento", "Causa", "Notas"];
    if (money) header.push("Modalidad", "Precio unitario", "Moneda", "Comisión", "Flete", "Importe bruto", "Importe neto", "Costo asignado", "Resultado");
    return {
      name: "Movimientos",
      rows: [
        header,
        ...rows.map((m) => {
          const r: CellValue[] = [m.date, MOVEMENT_LABELS[m.type as MovementType] || m.type, m.counterparty, m.headCount, m.totalWeight ? toNum(m.totalWeight, 1) : null, m.fromLotId ? lotName.get(m.fromLotId) || "" : "", m.toLotId ? lotName.get(m.toLotId) || "" : "", m.documentRef, m.cause, m.notes];
          if (money) r.push(m.priceMode, m.unitPrice ? toNum(m.unitPrice, 4) : null, m.currency, m.commission ? toNum(m.commission) : null, m.freight ? toNum(m.freight) : null, m.grossAmount ? toNum(m.grossAmount) : null, m.netAmount ? toNum(m.netAmount) : null, m.allocatedCost ? toNum(m.allocatedCost) : null, m.result ? toNum(m.result) : null);
          return r;
        }),
      ],
    };
  }
  if (kind === "gastos") {
    assertCan(ctx.role, "read_money");
    const rows = listExpenses(ctx);
    return {
      name: "Gastos",
      rows: [
        ["Fecha", "Categoría", "Subtipo", "Descripción", "Proveedor", "Cantidad", "Unidad", "Precio unitario", "Total", "Moneda", "Imputación", "Comprobante", "Notas"],
        ...rows.map((e) => [
          e.date,
          EXPENSE_CATEGORY_LABELS[e.category as ExpenseCategory] || e.category,
          e.subcategory,
          e.description,
          e.supplier,
          e.quantity ? toNum(e.quantity, 3) : null,
          e.unit,
          e.unitPrice ? toNum(e.unitPrice, 4) : null,
          e.total ? toNum(e.total) : null,
          e.currency,
          e.allocations.map((a) => `${a.lotId ? lotName.get(a.lotId) || a.lotId : "Campo general"} ${a.percentage}%`).join("; "),
          e.receiptName,
          e.notes,
        ]),
      ],
    };
  }
  if (kind === "lotes") {
    assertCan(ctx.role, "read_money");
    const rows = compareLots(ctx);
    return {
      name: "Resultado por lote",
      rows: [
        ["Lote", "Categoría", "Estado", "Cabezas", "Peso promedio", "GDP", "GDP tendencia", "Kg producidos", "Gastos / kg producido", "Costo total / kg producido", "Costo por cabeza", "Costo acumulado", "Precio ref.", "Valor de mercado", "Margen proyectado", "Resultado realizado"],
        ...rows.map((l) => [l.name, CATEGORY_LABELS[l.category as Category] || l.category, l.status, l.headCount, l.avgWeight, l.gdp, l.trendGdp, l.kgProduced, l.costPerKgProduced, l.fullCostPerKgProduced, l.costPerHead, l.currentCost, l.pricePerKg, l.marketValue, l.projectedMargin, l.realizedResult]),
      ],
    };
  }
  throw badRequest("Tipo de exportación desconocido.");
}

export function exportData(ctx: FarmCtx, kind: ExportKind, format: "xlsx" | "csv") {
  const { name, rows } = rowsFor(ctx, kind);
  const base = `${ctx.farm.name.replace(/[^\w\- ]+/g, "")}-${kind}`;
  if (format === "csv") return { fileName: `${base}.csv`, contentType: "text/csv; charset=utf-8", body: new TextEncoder().encode(toCsv(rows, ";")) };
  return { fileName: `${base}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: writeWorkbook([{ name, rows }]) };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number | null | undefined, cur: string) => (n === null || n === undefined ? "-" : `${cur} ${n.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Informe de cierre o situación del lote como página imprimible. */
export function lotReportHtml(ctx: FarmCtx, lotId: string) {
  assertCan(ctx.role, "read_money");
  const metrics = loadFarmMetrics(ctx);
  const m = metrics.lots.get(lotId);
  if (!m) throw badRequest("El lote no existe.");
  const cur = ctx.farm.currency;
  const closing = (m.lot.closingResult || null) as Record<string, string | number> | null;
  const result = closing ? Number(closing.result) : toNum(m.revenue.minus(m.soldCost).minus(m.deathLoss).minus(m.unassignedExpenses));
  const animalRows = [...metrics.animals.values()].filter((a) => a.weighings.some((w) => w.lotId === lotId) || a.animal.currentLotId === lotId);
  const rows = animalRows
    .map((a) => {
      const inLot = a.weighings.filter((w) => w.lotId === lotId);
      const first = inLot[0];
      const last = inLot[inLot.length - 1];
      return `<tr><td>${esc(a.animal.eid)}</td><td>${esc(a.animal.visualTag || "")}</td><td>${esc(CATEGORY_LABELS[a.animal.category as Category] || a.animal.category)}</td><td>${esc(a.animal.status)}</td><td class="n">${first ? toNum(first.weight, 1) : "-"}</td><td class="n">${last ? toNum(last.weight, 1) : "-"}</td><td class="n">${first && last ? toNum(Number(last.weight) - Number(first.weight), 1) : "-"}</td><td class="n">${money(toNum(a.accumulatedCost), cur)}</td></tr>`;
    })
    .join("");
  const hist = m.history.map((h) => `<tr><td>${h.date}</td><td class="n">${h.count}</td><td class="n">${toNum(h.avgWeight, 1)}</td></tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe de lote · ${esc(m.lot.name)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2a22;margin:32px;max-width:960px}h1{margin:0 0 4px;font-size:26px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #d9e0d5;padding-bottom:4px}.muted{color:#6b7a70}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.card{border:1px solid #d9e0d5;border-radius:10px;padding:12px}.card small{display:block;color:#6b7a70;font-size:12px;text-transform:uppercase;letter-spacing:.04em}.card strong{font-size:20px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #e6ebe3;text-align:left}td.n,th.n{text-align:right}.result{font-size:22px;font-weight:700;color:${result >= 0 ? "#2f6b45" : "#a33"}}.demo{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:#fdf1d8;color:#8a5a00;font-size:11px;font-weight:700;letter-spacing:.06em}@media print{body{margin:12mm}button{display:none}}</style></head><body>
<button onclick="window.print()" style="float:right;padding:8px 14px;border:1px solid #9bb0a1;border-radius:8px;background:#fff;cursor:pointer">Imprimir</button>
<p class="muted">${esc(ctx.farm.name)} · Informe de ${m.lot.status === "cerrado" ? "cierre" : "situación"} de lote · ${metrics.asOf}<span class="demo">DEMO</span></p>
<h1>${esc(m.lot.name)}</h1>
<p class="muted">${esc(CATEGORY_LABELS[m.lot.category as Category] || m.lot.category)} · desde ${m.lot.startDate}${m.lot.closedAt ? ` · cerrado el ${m.lot.closedAt.slice(0, 10)}` : ""}</p>
<div class="grid">
<div class="card"><small>Resultado</small><strong class="result">${money(result, cur)}</strong></div>
<div class="card"><small>Ingresos por ventas</small><strong>${money(toNum(m.revenue), cur)}</strong></div>
<div class="card"><small>Kilos producidos</small><strong>${toNum(m.kgProduced, 0)} kg</strong></div>
<div class="card"><small>GDP promedio</small><strong>${m.gdp ? toNum(m.gdp, 2) : "-"} kg/día</strong></div>
<div class="card"><small>Animales vendidos</small><strong>${m.soldHeads}</strong></div>
<div class="card"><small>Muertes</small><strong>${m.deadHeads}</strong></div>
<div class="card"><small>Gastos directos</small><strong>${money(toNum(m.directExpenses), cur)}</strong></div>
<div class="card"><small>Gastos prorrateados</small><strong>${money(toNum(m.allocatedExpenses), cur)}</strong></div>
</div>
<h2>Composición del resultado</h2>
<table><tr><th>Concepto</th><th class="n">Importe</th></tr>
<tr><td>Ingresos netos por ventas</td><td class="n">${money(toNum(m.revenue), cur)}</td></tr>
<tr><td>Costo acumulado de los animales vendidos (compra + gastos)</td><td class="n">- ${money(toNum(m.soldCost), cur)}</td></tr>
<tr><td>Pérdida por muertes</td><td class="n">- ${money(toNum(m.deathLoss), cur)}</td></tr>
<tr><td>Gastos sin animales presentes</td><td class="n">- ${money(toNum(m.unassignedExpenses), cur)}</td></tr>
<tr><td>Costo por kg producido (gastos)</td><td class="n">${m.costPerKgProduced ? money(toNum(m.costPerKgProduced, 4), cur) : "-"}</td></tr>
<tr><th>Resultado</th><th class="n">${money(result, cur)}</th></tr></table>
${m.headCount ? `<p class="muted">El lote todavía tiene ${m.headCount} animales activos con un costo acumulado de ${money(toNum(m.currentCost), cur)}.</p>` : ""}
<h2>Evolución del peso promedio</h2>
<table><tr><th>Fecha</th><th class="n">Animales</th><th class="n">Peso promedio (kg)</th></tr>${hist || "<tr><td colspan=3 class=muted>Sin pesadas</td></tr>"}</table>
<h2>Animales (${animalRows.length})</h2>
<table><tr><th>Caravana</th><th>Visual</th><th>Categoría</th><th>Estado</th><th class="n">Peso inicial</th><th class="n">Peso final</th><th class="n">Ganancia</th><th class="n">Costo acumulado</th></tr>${rows}</table>
<p class="muted" style="margin-top:28px">Generado por Rodeo (demo con datos de ejemplo) el ${metrics.asOf}. Los costos incluyen el costo de compra y la parte proporcional de los gastos imputados (directos y prorrateo ${ctx.farm.allocationMethod === "heads" ? "por cabezas" : "por cabeza-día"}).</p>
</body></html>`;
}

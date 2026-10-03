// Construcción de los datos semilla. Igual que el seed del servidor
// (apps/api/src/core/seed.ts), carga los datos pasando por los mismos servicios
// que usa la app: compras, importaciones del lector, ventas, cierres, gastos,
// sanidad y reproducción, así los números quedan coherentes entre sí.

import { addDays, daysBetween, writeWorkbook, type CellValue } from "@rodeo/shared";
import { emptyTables, type Tables } from "../schema";
import { db, demoToday, loadDb, resetDb, saveDb, useTables, withIdSource, nowIso } from "../db";
import { systemCtx, type FarmCtx, type SessionUser } from "../core";
import { createFarm } from "../services/farms";
import { createLot, closeLot, createPaddock } from "../services/lots";
import { registerPurchase, registerSale, registerDeath, registerBirth } from "../services/movements";
import { bulkUpdateAnimals } from "../services/animals";
import { createOwner, addReproEvent } from "../services/owners";
import { uploadImport, confirmImport } from "../services/imports";
import { createExpense } from "../services/expenses";
import { createHealthEvent, createReminder } from "../services/health";
import { addPrice } from "../services/prices";
import { manualWeighing } from "../services/weighings";
import { CARAVANAS_LECTOR } from "./caravanas-lector";
import { seedAcgHistory, runAcgScheduler } from "./acg";
import * as C from "./catalog";

// Generador determinista: el seed es reproducible (mismos ids y pesos).
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededUuid(random: () => string | number) {
  const hex = () => Math.floor(Number(random()) * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => (c === "x" ? hex() : ((parseInt(hex(), 16) & 0x3) | 0x8).toString(16)));
}

/** .xlsx con el formato exacto del lector (hoja PESADA). */
export function readerWorkbook(rows: { eid: string; weight: number; time: string; manual?: boolean; observation?: string | null; sex?: string }[], date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const table: CellValue[][] = [["N°", "Fecha", "IDE", "Modo", "Observación", "Peso (kg)", "Sexo"]];
  rows.forEach((r, i) => table.push([i + 1, `${d}/${m}/${y}, ${r.time}`, r.eid, r.manual ? "Manual" : "", r.observation ?? null, r.weight, r.sex ?? "0"]));
  return writeWorkbook([{ name: "PESADA", rows: table }]);
}

const fileName = (date: string) => `${date.replace(/-/g, "_")} - PESADA.xlsx`;

function seedEsperanza(ctx: FarmCtx, d: (iso: string) => string, random: () => number) {
  const today = ctx.today;
  const ownerMartin = createOwner(ctx, C.OWNERS.martin);
  const ownerSucesion = createOwner(ctx, C.OWNERS.sucesion);
  const paddockA = createPaddock(ctx, C.PADDOCKS.pradera);
  const paddockB = createPaddock(ctx, C.PADDOCKS.natural);
  createPaddock(ctx, C.PADDOCKS.verdeo);

  const pool = [...CARAVANAS_LECTOR].sort((a, b) => a.weight - b.weight);
  const terneros = pool.slice(0, 60);
  const novillos = pool.slice(60);
  const finalDate = d("2026-09-18");

  // ---- Gastos del campo (globales, se prorratean): antes de las ventas, para que entren en su costo ----
  monthlyExpenses(ctx, 7, 1);
  createExpense(ctx, { category: "infraestructura", description: "Reparación de alambrado", supplier: "Herrería Techera", date: d("2026-05-28"), total: 1380 });
  createExpense(ctx, { category: "pasturas", subcategory: "fertilizantes", description: "Fertilizante fosfatado", supplier: "Agroinsumos del Centro", date: d("2026-09-15"), quantity: 2000, unit: "kg", unitPrice: "0.925" });

  // ---- Lote cerrado: novillos de otoño (comprados en noviembre, vendidos en agosto) ----
  const closedLot = createLot(ctx, { name: "Novillos otoño", category: "novillo", targetWeight: 450, startDate: d("2025-11-10"), paddockId: paddockB.id, color: "#8b9980" });
  const closedEids = Array.from({ length: 30 }, (_, i) => `8580000${String(46475900 + i).padStart(8, "0")}`);
  registerPurchase(ctx, {
    date: d("2025-11-10"),
    counterparty: "Ganadera San José",
    lotId: closedLot.id,
    priceMode: "kg",
    unitPrice: "3.25",
    commission: "780",
    freight: "420",
    documentRef: "Guía 11-2025-0417",
    ownerId: ownerMartin.id,
    animals: closedEids.map((eid) => ({ eid, weight: 280 + Math.round(random() * 30) })),
  });
  for (const [i, date] of ["2026-01-15", "2026-03-20", "2026-05-22", "2026-07-24"].map(d).entries()) {
    const days = daysBetween(d("2025-11-10"), date);
    const rows = closedEids.map((eid, j) => ({ eid, weight: Math.round(290 + days * (0.55 + (j % 5) * 0.03) + random() * 6), time: `09:${String(10 + j).padStart(2, "0")}:00` }));
    const up = uploadImport(ctx, { fileName: fileName(date), bytes: readerWorkbook(rows, date) });
    confirmImport(ctx, up.batchId, { defaultLotId: closedLot.id, name: `Control ${i + 1} · Novillos otoño` });
  }
  createExpense(ctx, { category: "alimentacion", description: "Ración de terminación", supplier: "Cooperativa Agraria", date: d("2026-06-05"), quantity: 12000, unit: "kg", unitPrice: "0.32", allocations: [{ lotId: closedLot.id }] });

  // ---- Lote 1: Novillos compra marzo ----
  const lot1 = createLot(ctx, { name: "Novillos compra marzo", category: "novillo", targetWeight: 450, startDate: d("2026-03-12"), paddockId: paddockA.id, color: "#44775b" });
  const gdp1 = 0.82;
  const days1 = daysBetween(d("2026-03-12"), finalDate);
  const start1 = novillos.map((a, j) => ({ eid: a.eid, weight: Math.max(180, Math.round(a.weight - gdp1 * days1 + (random() - 0.5) * 20)), jitter: (j % 7) * 0.02 - 0.06 }));
  registerPurchase(ctx, {
    date: d("2026-03-12"),
    counterparty: "Ganadera San José",
    lotId: lot1.id,
    priceMode: "kg",
    unitPrice: "3.60",
    commission: "1240",
    freight: "650",
    documentRef: "Guía 03-2026-0119",
    ownerId: ownerMartin.id,
    animals: start1.map((a) => ({ eid: a.eid, weight: a.weight })),
  });

  // ---- Lote 2: Terneros recría ----
  const lot2 = createLot(ctx, { name: "Terneros recría", category: "ternero", targetWeight: 320, startDate: d("2026-04-20"), paddockId: paddockB.id, color: "#92b5a2" });
  const gdp2 = 0.68;
  const days2 = daysBetween(d("2026-04-20"), finalDate);
  const start2 = terneros.map((a, j) => ({ eid: a.eid, weight: Math.max(90, Math.round(a.weight - gdp2 * days2 + (random() - 0.5) * 16)), jitter: (j % 5) * 0.02 - 0.04 }));
  registerPurchase(ctx, {
    date: d("2026-04-20"),
    counterparty: "Remate Feria Durazno",
    lotId: lot2.id,
    priceMode: "kg",
    unitPrice: "4.20",
    commission: "1180",
    freight: "520",
    ownerId: ownerSucesion.id,
    animals: start2.map((a) => ({ eid: a.eid, weight: a.weight })),
  });
  // Parte de los terneros quedó a nombre del banco por un préstamo.
  bulkUpdateAnimals(ctx, { eids: start2.slice(0, 18).map((a) => a.eid), pledge: { bank: "BROU", ref: "Préstamo 2026-0114", since: d("2026-04-28") } });

  // Sesiones intermedias en el formato del lector.
  const mid = (lotStart: string, animalsStart: typeof start1, gdp: number, date: string) => {
    const days = daysBetween(lotStart, date);
    return animalsStart.map((a, j) => ({ eid: a.eid, weight: Math.round(a.weight + days * (gdp + a.jitter) + (random() - 0.5) * 8), time: `${String(9 + Math.floor(j / 40)).padStart(2, "0")}:${String((j * 3) % 60).padStart(2, "0")}:${String((j * 17) % 60).padStart(2, "0")}`, manual: j % 23 === 0 }));
  };
  const sessions: { date: string; lotId: string; name: string; bytes: Uint8Array }[] = [];
  for (const [i, date] of ["2026-05-14", "2026-07-16"].map(d).entries()) sessions.push({ date, lotId: lot1.id, name: `Control ${i + 1} · Novillos`, bytes: readerWorkbook(mid(d("2026-03-12"), start1, gdp1, date), date) });
  for (const [i, date] of ["2026-06-10", "2026-08-05"].map(d).entries()) sessions.push({ date, lotId: lot2.id, name: `Seguimiento recría ${i + 1}`, bytes: readerWorkbook(mid(d("2026-04-20"), start2, gdp2, date), date) });
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  for (const s of sessions) {
    const up = uploadImport(ctx, { fileName: fileName(s.date), bytes: s.bytes });
    confirmImport(ctx, up.batchId, { defaultLotId: s.lotId, name: s.name });
  }
  const byEid = new Map(db.animals.filter((a) => a.farmId === ctx.farm.id).map((a) => [a.eid, a.id]));
  registerDeath(ctx, { date: d("2026-07-03"), animalIds: [byEid.get(terneros[5].eid)!], cause: "Timpanismo" });

  // Última sesión: el archivo real del lector, con los dos lotes juntos.
  const finalRows = CARAVANAS_LECTOR.filter((r) => r.eid !== terneros[5].eid).map((r, j) => ({ eid: r.eid, weight: r.weight, time: `${String(9 + Math.floor(j / 35)).padStart(2, "0")}:${String((j * 2) % 60).padStart(2, "0")}:${String((j * 13) % 60).padStart(2, "0")}`, manual: r.manual, observation: r.observation }));
  const finalUp = uploadImport(ctx, { fileName: fileName(finalDate), bytes: readerWorkbook(finalRows, finalDate) });
  confirmImport(ctx, finalUp.batchId, { defaultLotId: lot1.id, name: "Pesada general" });
  manualWeighing(ctx, { animal: novillos[0].eid, weight: Math.round(novillos[0].weight + 2), date: today, observation: "Control en la manga" });

  // ---- Gastos imputados a lotes ----
  createExpense(ctx, { category: "alimentacion", description: "Ración de terminación", supplier: "Cooperativa Agraria", date: d("2026-09-17"), quantity: 8000, unit: "kg", unitPrice: "0.355", allocations: [{ lotId: lot1.id }] });
  createExpense(ctx, { category: "alimentacion", description: "Ración de recría", supplier: "Cooperativa Agraria", date: d("2026-08-12"), quantity: 5000, unit: "kg", unitPrice: "0.38", allocations: [{ lotId: lot2.id }] });
  createExpense(ctx, { category: "pasturas", subcategory: "semillas", description: "Semilla de raigrás", supplier: "Agroinsumos del Centro", date: d("2026-04-02"), quantity: 400, unit: "kg", unitPrice: "2.9", allocations: [{ lotId: lot1.id, percentage: 60 }, { lotId: lot2.id, percentage: 40 }] });
  const sanidad = createExpense(ctx, { category: "sanidad", description: "Antiparasitario ivermectina 1%", supplier: "Veterinaria del Sur", date: d("2026-09-12"), quantity: 2, unit: "litros", unitPrice: "320", allocations: [{ lotId: lot2.id }] });

  // ---- Sanidad ----
  createHealthEvent(ctx, { type: "vacunacion", product: "Vacuna clostridial", dose: "5 ml por animal", date: d("2026-06-12"), lotId: lot2.id, withdrawalDays: 0, reminder: { title: "Refuerzo clostridial", dueDate: d("2026-09-25") } });
  createHealthEvent(ctx, { type: "vacunacion", product: "Vacuna clostridial", dose: "5 ml por animal", date: d("2026-04-15"), lotId: lot1.id, withdrawalDays: 0 });
  createHealthEvent(ctx, { type: "desparasitacion", product: "Ivermectina 1%", dose: "1 ml / 50 kg", date: d("2026-09-12"), lotId: lot2.id, withdrawalDays: 28, expenseId: sanidad.id });
  createHealthEvent(ctx, { type: "tratamiento", product: "Oxitetraciclina LA", dose: "20 ml", date: d("2026-08-30"), animalIds: [byEid.get(novillos[3].eid)!], withdrawalDays: 21, notes: "Queratoconjuntivitis" });
  createReminder(ctx, { title: "Baño garrapaticida", dueDate: addDays(today, 12), lotId: lot1.id });
  createHealthEvent(ctx, { type: "enfermedad", product: "Garrapatas", date: addDays(today, -6), animalIds: [byEid.get(novillos[7].eid)!, byEid.get(novillos[11].eid)!], withdrawalDays: 0, notes: "Detectadas en la manga; programar baño." });

  // ---- Lote de cría: vacas de dos propietarios, un toro, entores y preñeces ----
  const lot4 = createLot(ctx, { name: "Vacas de cría", category: "vaca", startDate: d("2026-05-05"), paddockId: paddockB.id, color: "#b9875a" });
  // Rodeo de cría comprado en una tropa (por kg) y el toro aparte (por cabeza).
  const cowEids = Array.from({ length: 12 }, (_, i) => `8580000777001${String(i + 1).padStart(2, "0")}`);
  registerPurchase(ctx, {
    date: d("2026-05-05"),
    counterparty: "Cabaña Los Robles",
    lotId: lot4.id,
    priceMode: "kg",
    unitPrice: "2.45",
    commission: "310",
    freight: "180",
    documentRef: "Guía 05-2026-0207",
    ownerId: ownerMartin.id,
    animals: cowEids.map((eid, i) => ({ eid, visualTag: String(301 + i), category: i < 9 ? "vaca" : "vaquillona", sex: "hembra", weight: (i < 9 ? 430 : 360) + Math.round((random() - 0.5) * 40) })),
  });
  registerPurchase(ctx, { date: d("2026-05-05"), counterparty: "Cabaña Santa Clara", lotId: lot4.id, priceMode: "cabeza", unitPrice: "3200", category: "toro", ownerId: ownerMartin.id, animals: [{ eid: "858000077700001", visualTag: "T1", sex: "macho", weight: 780 }] });
  const cowRows = cowEids.map((eid) => db.animals.find((a) => a.farmId === ctx.farm.id && a.eid === eid)!);
  cowRows.forEach((a, i) => (a.breed = i % 3 === 0 ? "Angus" : "Hereford"));
  const toro = db.animals.find((a) => a.farmId === ctx.farm.id && a.eid === "858000077700001")!;
  toro.breed = "Hereford";
  bulkUpdateAnimals(ctx, { eids: cowEids.filter((_, i) => i % 4 === 3), ownerId: ownerSucesion.id });
  const vacas = cowRows.map((a) => a.id);

  // ---- Venta y cierre de los novillos de otoño (con todos los lotes y gastos del período ya cargados) ----
  const closedIds = db.animals.filter((a) => a.farmId === ctx.farm.id && closedEids.includes(a.eid)).map((a) => a.id);
  registerSale(ctx, {
    date: d("2026-08-20"),
    counterparty: "Frigorífico del Norte",
    animalIds: closedIds,
    priceMode: "kg",
    unitPrice: "3.02",
    commission: "640",
    freight: "380",
    documentRef: "Remito 4471",
    weights: Object.fromEntries(closedIds.map((id, j) => [id, 440 + Math.round(random() * 25) + (j % 3) * 4])),
  });
  closeLot(ctx, closedLot.id);

  // La 301 entró preñada y ya parió (el nacimiento registra el parto); después volvió al entore.
  addReproEvent(ctx, vacas[0], { type: "prenez", date: d("2026-05-06"), months: 8, notes: "Preñada al ingreso" });
  registerBirth(ctx, { date: d("2026-06-04"), lotId: lot4.id, motherId: vacas[0], animals: [{ eid: "858000077700201", visualTag: "301A", sex: "hembra", weight: 33 }] });
  addReproEvent(ctx, vacas[0], { type: "entore", date: d("2026-07-15"), bullId: toro.id });
  // La 302 también entró preñada y está por parir.
  addReproEvent(ctx, vacas[1], { type: "prenez", date: d("2026-05-06"), months: 4.5, notes: "Preñada al ingreso" });
  // El resto: entore con el toro; tacto con 6 preñadas, 2 vacías y 2 sin diagnóstico.
  for (const [i, id] of vacas.entries()) {
    if (i < 2) continue;
    addReproEvent(ctx, id, { type: "entore", date: d("2026-05-10"), bullId: toro.id });
    if (i >= 10) continue;
    if (i < 8) addReproEvent(ctx, id, { type: "prenez", date: d("2026-08-20"), months: 1 + (i % 3), notes: "Tacto veterinario" });
    else addReproEvent(ctx, id, { type: "vacia", date: d("2026-08-20"), notes: "Tacto veterinario" });
  }
  monthlyPrices(ctx, ["novillo", "ternero", "vaquillona", "vaca", "toro"]);
}

function seedOmbu(ctx: FarmCtx, d: (iso: string) => string, random: () => number) {
  const owner = createOwner(ctx, C.OWNERS.martin);
  const paddock = createPaddock(ctx, C.PADDOCKS.ombu);
  const start = d("2026-06-02");
  const lot = createLot(ctx, { name: "Vaquillonas de reposición", category: "vaquillona", targetWeight: 360, startDate: start, paddockId: paddock.id, color: "#cad6aa" });
  const heads = Array.from({ length: 22 }, (_, i) => ({ eid: `8580000999100${String(i + 1).padStart(2, "0")}`, weight: 225 + Math.round(random() * 50), jitter: (i % 4) * 0.03 - 0.045 }));
  registerPurchase(ctx, { date: start, counterparty: "Escritorio Gutiérrez Hnos.", lotId: lot.id, priceMode: "kg", unitPrice: "3.40", commission: "420", freight: "260", documentRef: "Guía 06-2026-0388", ownerId: owner.id, category: "vaquillona", animals: heads.map((h) => ({ eid: h.eid, weight: h.weight })) });
  for (const [i, date] of ["2026-08-10", "2026-09-12"].map(d).entries()) {
    const days = daysBetween(start, date);
    const rows = heads.map((h, j) => ({ eid: h.eid, weight: Math.round(h.weight + days * (0.55 + h.jitter) + (random() - 0.5) * 6), time: `08:${String(15 + j).padStart(2, "0")}:00`, sex: "2" }));
    const up = uploadImport(ctx, { fileName: fileName(date), bytes: readerWorkbook(rows, date) });
    confirmImport(ctx, up.batchId, { defaultLotId: lot.id, name: `Control ${i + 1} · Vaquillonas` });
  }
  createExpense(ctx, { category: "alimentacion", description: "Sales minerales", supplier: "Cooperativa Agraria", date: d("2026-07-08"), quantity: 1200, unit: "kg", unitPrice: "0.42", allocations: [{ lotId: lot.id }] });
  createHealthEvent(ctx, { type: "vacunacion", product: "Vacuna antiaftosa", dose: "2 ml por animal", date: d("2026-06-05"), lotId: lot.id, withdrawalDays: 0 });
  monthlyExpenses(ctx, 4, 0.4);
  monthlyPrices(ctx, ["vaquillona", "novillo", "vaca"]);
}

/** Gastos fijos de los últimos `months` meses (relativos a hoy). */
function monthlyExpenses(ctx: FarmCtx, months: number, scale: number) {
  const [y, m] = ctx.today.split("-").map(Number);
  for (let k = months - 1; k >= 0; k--) {
    const date = new Date(Date.UTC(y, m - 1 - k, 1));
    const ym = date.toISOString().slice(0, 7);
    for (const e of C.MONTHLY_EXPENSES) {
      if (scale < 1 && e.category !== "mano_de_obra") continue;
      const day = `${ym}-${String(e.day).padStart(2, "0")}`;
      if (day > ctx.today) continue;
      const label = new Date(day + "T12:00:00").toLocaleDateString("es-UY", { month: "long", year: "numeric" });
      createExpense(ctx, { category: e.category, description: `${e.description} · ${label}`, supplier: e.supplier, date: day, quantity: e.quantity, unit: e.unit, total: Math.round(e.total * scale) });
    }
  }
}

/** Precios de referencia mensuales en pie (día 15 de cada uno de los últimos 6 meses). */
function monthlyPrices(ctx: FarmCtx, categories: string[]) {
  const [y, m] = ctx.today.split("-").map(Number);
  for (let k = 5; k >= 0; k--) {
    const ym = new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7);
    const day = `${ym}-15` > ctx.today ? addDays(ctx.today, -1) : `${ym}-15`;
    for (const cat of categories) {
      const series = C.MONTHLY_PRICES[cat];
      if (!series) continue;
      addPrice(ctx, { category: cat, pricePerKg: series[5 - k].toFixed(2), date: day, source: k === 0 ? "manual" : "csv", provider: k === 0 ? null : "INAC (ejemplo)" });
    }
  }
}

/** Arma toda la base de la demo desde cero. */
export function buildSeed(): Tables {
  const tables = emptyTables();
  useTables(tables);
  const today = demoToday();
  const shift = daysBetween(C.ANCHOR, today);
  const d = (iso: string) => addDays(iso, shift);
  const random = rng(42);
  const ids = rng(7);
  withIdSource(
    () => seededUuid(ids),
    () => {
      const now = nowIso();
      for (const u of C.DEMO_USERS) db.users.push({ id: u.id, name: u.name, email: u.email, password: C.DEMO_PASSWORD, createdAt: now });
      const martin: SessionUser = { id: "u-martin", email: "demo@rodeo.app", name: "Martín González" };
      for (const f of C.FARMS) createFarm(martin, { name: f.name, location: f.location, hectares: f.hectares, timezone: "America/Montevideo" }, f.id);
      for (const m of C.FARM_MEMBERS) db.farmMembers.push({ ...m, createdAt: now });
      const esperanza = db.farms.find((f) => f.id === C.FARM_ESPERANZA)!;
      const ombu = db.farms.find((f) => f.id === C.FARM_OMBU)!;
      esperanza.alertConfig = { ...esperanza.alertConfig, calvingSoonDays: 30, email: true };
      seedEsperanza(systemCtx(esperanza, martin, today), d, random);
      seedOmbu(systemCtx(ombu, martin, today), d, random);
      seedAcgHistory(esperanza.id);
      seedAcgHistory(ombu.id);
    },
  );
  return tables;
}

// ---------- Arranque ----------

let booted: { reseeded: boolean; acg: { weekEnd: string; weeks: number } | null } | null = null;

/** Carga (o genera) la base y corre el planificador de precios. Idempotente. */
export function ensureDb() {
  if (booted) return booted;
  const { reseeded } = loadDb(buildSeed);
  const acg = runAcgScheduler();
  if (acg) saveDb();
  booted = { reseeded, acg: reseeded ? null : acg };
  return booted;
}

export function reseed() {
  resetDb(buildSeed);
  booted = { reseeded: true, acg: null };
}

/** Planificador en segundo plano mientras la demo está abierta (cada 10 minutos). */
export function startAcgScheduler(onLoaded: (info: { weekEnd: string; weeks: number }) => void) {
  const id = setInterval(() => {
    const loaded = runAcgScheduler();
    if (loaded) {
      saveDb();
      onLoaded(loaded);
    }
  }, 10 * 60 * 1000);
  return () => clearInterval(id);
}

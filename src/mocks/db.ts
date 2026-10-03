// Base de datos simulada: tablas en memoria que se guardan en localStorage
// después de cada cambio. "Reiniciar demo" vuelve a generar los datos semilla.

import { emptyTables, type Tables } from "./schema";
import { todayIn } from "@rodeo/shared";

const DB_KEY = "rodeo-demo:db";
const FILES_KEY = "rodeo-demo:files";
// Subir este número invalida los datos guardados con un seed anterior.
export const SEED_VERSION = 6;

type Stored = { version: number; seededOn: string; dirty: boolean; tables: Tables };

export let db: Tables = emptyTables();
let meta = { seededOn: "", dirty: false };

// ---------- Identificadores ----------

let idSource: (() => string) | null = null;

/** Durante el seed los ids salen de un generador determinista (datos reproducibles). */
export function withIdSource<T>(source: () => string, fn: () => T): T {
  const prev = idSource;
  idSource = source;
  try {
    return fn();
  } finally {
    idSource = prev;
  }
}

export function uuid(): string {
  if (idSource) return idSource();
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Reloj de la demo: los instantes se generan con la hora real; durante el seed
// se pueden fijar para que "createdAt" respete el orden de los hechos.
let clock: (() => string) | null = null;
export function withClock<T>(source: () => string, fn: () => T): T {
  const prev = clock;
  clock = source;
  try {
    return fn();
  } finally {
    clock = prev;
  }
}
export const nowIso = () => (clock ? clock() : new Date().toISOString());

export const demoToday = () => todayIn("America/Montevideo");

// ---------- Persistencia ----------

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return parsed && parsed.version === SEED_VERSION && parsed.tables ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDb() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify({ version: SEED_VERSION, seededOn: meta.seededOn, dirty: meta.dirty, tables: db } satisfies Stored));
  } catch {
    /* sin almacenamiento: la demo sigue funcionando en memoria */
  }
}

/** Marca que el usuario cambió datos (desde ahí la demo no se regenera sola). */
export function markDirty() {
  meta.dirty = true;
  saveDb();
}

/**
 * Carga la base guardada. Si no hay, es de otra versión, o nadie la modificó y
 * es de otro día, se regenera para que la demo siempre arranque "al día".
 */
export function loadDb(seed: () => Tables) {
  const stored = read();
  const today = demoToday();
  if (stored && (stored.dirty || stored.seededOn === today)) {
    db = stored.tables;
    meta = { seededOn: stored.seededOn, dirty: stored.dirty };
    return { reseeded: false };
  }
  clearFiles();
  db = seed();
  meta = { seededOn: today, dirty: false };
  saveDb();
  return { reseeded: true };
}

export function resetDb(seed: () => Tables) {
  clearFiles();
  db = seed();
  meta = { seededOn: demoToday(), dirty: false };
  saveDb();
}

/** Reemplaza las tablas (lo usa el seed mientras construye los datos). */
export function useTables(tables: Tables) {
  db = tables;
}

// ---------- Archivos (comprobantes y archivos originales de pesadas) ----------

type StoredFile = { name: string; type: string; b64: string };
const MAX_FILE = 400 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const memoryFiles = new Map<string, { name: string; type: string; bytes: Uint8Array }>();

function readFiles(): Record<string, StoredFile> {
  try {
    return JSON.parse(localStorage.getItem(FILES_KEY) || "{}");
  } catch {
    return {};
  }
}

function clearFiles() {
  memoryFiles.clear();
  try {
    localStorage.removeItem(FILES_KEY);
  } catch {
    /* nada */
  }
}

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Guarda un archivo: en memoria siempre y en el navegador si es chico. */
export function putFile(key: string, bytes: Uint8Array, type: string, name: string) {
  memoryFiles.set(key, { name, type, bytes });
  if (bytes.byteLength > MAX_FILE) return;
  const files = readFiles();
  const total = Object.values(files).reduce((n, f) => n + f.b64.length, 0);
  if (total + bytes.byteLength * 1.4 > MAX_TOTAL) return;
  files[key] = { name, type, b64: toB64(bytes) };
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    /* sin espacio: queda solo en memoria */
  }
}

export function getFile(key: string) {
  const mem = memoryFiles.get(key);
  if (mem) return mem;
  const f = readFiles()[key];
  return f ? { name: f.name, type: f.type, bytes: fromB64(f.b64) } : null;
}

// ---------- Borrados en cascada (replican las claves foráneas de Postgres) ----------

export function deleteAnimalsCascade(ids: Set<string>) {
  if (!ids.size) return;
  db.animals = db.animals.filter((a) => !ids.has(a.id));
  db.lotMemberships = db.lotMemberships.filter((m) => !ids.has(m.animalId));
  db.weighings = db.weighings.filter((w) => !ids.has(w.animalId));
  db.movementAnimals = db.movementAnimals.filter((m) => !ids.has(m.animalId));
  db.healthEventAnimals = db.healthEventAnimals.filter((h) => !ids.has(h.animalId));
  db.reproEvents = db.reproEvents.filter((r) => !ids.has(r.animalId));
  for (const r of db.reproEvents) if (r.bullId && ids.has(r.bullId)) r.bullId = null;
}

export function deleteSessionCascade(id: string) {
  db.weighingSessions = db.weighingSessions.filter((s) => s.id !== id);
  db.weighings = db.weighings.filter((w) => w.sessionId !== id);
  db.lotAverageWeighings = db.lotAverageWeighings.filter((a) => a.sessionId !== id);
}

export function deleteExpenseCascade(id: string) {
  db.expenses = db.expenses.filter((e) => e.id !== id);
  db.expenseAllocations = db.expenseAllocations.filter((a) => a.expenseId !== id);
  for (const h of db.healthEvents) if (h.expenseId === id) h.expenseId = null;
}

export function deleteHealthEventCascade(id: string) {
  db.healthEvents = db.healthEvents.filter((h) => h.id !== id);
  db.healthEventAnimals = db.healthEventAnimals.filter((h) => h.eventId !== id);
  for (const r of db.healthReminders) if (r.eventId === id) r.eventId = null;
}

export function deleteLotCascade(id: string) {
  db.lots = db.lots.filter((l) => l.id !== id);
  db.lotMemberships = db.lotMemberships.filter((m) => m.lotId !== id);
  db.lotAverageWeighings = db.lotAverageWeighings.filter((a) => a.lotId !== id);
  db.expenseAllocations = db.expenseAllocations.filter((a) => a.lotId !== id);
  for (const a of db.animals) if (a.currentLotId === id) a.currentLotId = null;
  for (const w of db.weighings) if (w.lotId === id) w.lotId = null;
  for (const m of db.movements) {
    if (m.fromLotId === id) m.fromLotId = null;
    if (m.toLotId === id) m.toLotId = null;
  }
  for (const h of db.healthEvents) if (h.lotId === id) h.lotId = null;
  for (const r of db.healthReminders) if (r.lotId === id) r.lotId = null;
}

export function deleteFarmCascade(farmId: string) {
  const animalIds = new Set(db.animals.filter((a) => a.farmId === farmId).map((a) => a.id));
  deleteAnimalsCascade(animalIds);
  const movementIds = new Set(db.movements.filter((m) => m.farmId === farmId).map((m) => m.id));
  const eventIds = new Set(db.healthEvents.filter((h) => h.farmId === farmId).map((h) => h.id));
  const keep = <T extends { farmId: string }>(rows: T[]) => rows.filter((r) => r.farmId !== farmId);
  db.farms = db.farms.filter((f) => f.id !== farmId);
  db.farmMembers = keep(db.farmMembers);
  db.invitations = keep(db.invitations);
  db.paddocks = keep(db.paddocks);
  db.owners = keep(db.owners);
  db.lots = keep(db.lots);
  db.lotMemberships = keep(db.lotMemberships);
  db.weighingSessions = keep(db.weighingSessions);
  db.weighings = keep(db.weighings);
  db.lotAverageWeighings = keep(db.lotAverageWeighings);
  db.importBatches = keep(db.importBatches);
  db.movements = keep(db.movements);
  db.movementAnimals = db.movementAnimals.filter((m) => !movementIds.has(m.movementId));
  db.expenses = keep(db.expenses);
  db.expenseAllocations = keep(db.expenseAllocations);
  db.healthEvents = keep(db.healthEvents);
  db.healthEventAnimals = db.healthEventAnimals.filter((h) => !eventIds.has(h.eventId));
  db.healthReminders = keep(db.healthReminders);
  db.marketPrices = keep(db.marketPrices);
  db.reproEvents = keep(db.reproEvents);
}

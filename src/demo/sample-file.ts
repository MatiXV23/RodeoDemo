// Archivo de ejemplo del lector armado con los animales actuales del campo:
// pesos verosímiles de hoy y, a propósito, algunas filas con observaciones
// (caravanas nuevas, una repetida, una tipeada a mano, un salto de peso,
// un peso fuera de rango, un sexo distinto y un animal ya vendido) para
// recorrer todas las validaciones del importador.

import { addDays, daysBetween } from "@rodeo/shared";
import { db, demoToday } from "@/mocks/db";
import { ensureDb, readerWorkbook } from "@/mocks/seed";

type Row = { eid: string; weight: number; time: string; manual?: boolean; observation?: string | null; sex?: string };

export function buildSampleWeighing(farmId: string) {
  ensureDb();
  const today = demoToday();
  const lastByAnimal = new Map<string, { weight: number; date: string }>();
  for (const w of db.weighings) {
    if (w.farmId !== farmId) continue;
    const prev = lastByAnimal.get(w.animalId);
    if (!prev || w.date >= prev.date) lastByAnimal.set(w.animalId, { weight: Number(w.weight), date: w.date });
  }
  const activeLots = db.lots.filter((l) => l.farmId === farmId && l.status === "activo");
  const animals = db.animals.filter((a) => a.farmId === farmId && a.status === "activo" && a.currentLotId).sort((a, b) => a.eid.localeCompare(b.eid));
  const rows: Row[] = [];
  let minute = 0;
  const time = () => {
    minute += 1;
    return `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:${String((minute * 17) % 60).padStart(2, "0")}`;
  };
  // Peso de hoy: último peso + ~0,7 kg/día desde la última pesada.
  const todayWeight = (id: string, fallback: number) => {
    const last = lastByAnimal.get(id);
    if (!last) return fallback;
    const days = Math.max(0, daysBetween(last.date, today));
    return Math.round(last.weight + days * 0.7 + ((id.charCodeAt(0) % 5) - 2));
  };

  for (const lot of activeLots) {
    const inLot = animals.filter((a) => a.currentLotId === lot.id).slice(0, 12);
    for (const a of inLot) rows.push({ eid: a.eid, weight: todayWeight(a.id, 300), time: time(), sex: a.category === "vaca" || a.category === "vaquillona" ? "2" : "0" });
  }
  if (rows.length) {
    const first = rows[0];
    // Caravana repetida en el archivo (el lector la leyó dos veces).
    rows.push({ ...first, weight: first.weight + 2, time: time() });
    // Fila tipeada a mano en el lector.
    if (rows[1]) rows[1] = { ...rows[1], manual: true, observation: "Caravana ilegible" };
    // Salto de peso respecto de la pesada anterior.
    if (rows[2]) rows[2] = { ...rows[2], weight: rows[2].weight + 95 };
  }
  // Un ternero con un peso poco habitual para su categoría.
  const ternero = animals.find((a) => a.category === "ternero" && !rows.slice(0, 3).some((r) => r.eid === a.eid));
  if (ternero) {
    const r = rows.find((x) => x.eid === ternero.eid);
    if (r) r.weight = 345;
    else rows.push({ eid: ternero.eid, weight: 345, time: time() });
  }
  // Una hembra que el lector leyó como macho.
  const hembra = animals.find((a) => a.sex === "hembra" && a.category === "vaca");
  if (hembra) {
    const r = rows.find((x) => x.eid === hembra.eid);
    if (r) r.sex = "1";
    else rows.push({ eid: hembra.eid, weight: todayWeight(hembra.id, 450), time: time(), sex: "1" });
  }
  // Un animal que ya se vendió.
  const sold = db.animals.find((a) => a.farmId === farmId && a.status === "vendido");
  if (sold) rows.push({ eid: sold.eid, weight: 462, time: time() });
  // Caravanas nuevas, que no están registradas en el campo.
  const known = new Set(db.animals.filter((a) => a.farmId === farmId).map((a) => a.eid));
  let n = 1;
  for (const w of [238, 251, 246]) {
    let eid = `8580000555${String(n).padStart(5, "0")}`;
    while (known.has(eid)) eid = `8580000555${String(++n).padStart(5, "0")}`;
    known.add(eid);
    n++;
    rows.push({ eid, weight: w, time: time(), sex: "1", observation: "Compra feria" });
  }
  const date = today;
  return { fileName: `${date.replace(/-/g, "_")} - PESADA.xlsx`, bytes: readerWorkbook(rows, date), rows: rows.length, previous: addDays(date, -1) };
}

export function downloadSampleWeighing(farmId: string) {
  const { fileName, bytes } = buildSampleWeighing(farmId);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

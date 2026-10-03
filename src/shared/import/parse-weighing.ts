import { parseCsv, readFirstSheet, type CellValue } from "../xlsx";
import { normalizeHeader, EID_REGEX, WEIGHT_RANGES, ABSOLUTE_WEIGHT_RANGE, MAX_DAILY_VARIATION, MAX_SAME_DAY_VARIATION, SEX_LABELS, parseSex, type Category, type Sex } from "../domain";
import { parseReaderDate, daysBetween } from "../dates";
import { D } from "../decimal";

// ---------- Paso 1: parsear el archivo del lector (xlsx o csv) ----------

export type ParsedRow = {
  line: number; // número de fila en el archivo (1 = encabezado)
  eid: string;
  weight: string | null; // decimal en texto; null si no se pudo leer
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:mm:ss
  mode: "lector" | "manual";
  observation: string | null;
  sex: string | null;
};

const HEADER_ALIASES: Record<keyof Omit<ParsedRow, "line">, string[]> = {
  eid: ["ide", "id", "caravana", "caravana electronica", "eid", "rfid", "tag", "identificador", "chip"],
  weight: ["peso", "peso kg", "kg", "weight", "peso kilos", "kilos"],
  date: ["fecha", "date", "fecha hora", "fecha y hora", "datetime", "timestamp"],
  mode: ["modo", "mode", "manual", "origen", "tipo lectura"],
  observation: ["observacion", "observaciones", "obs", "nota", "notas", "comentario", "comentarios", "observation", "notes"],
  sex: ["sexo", "sex"],
  time: ["hora", "time"],
};

function findColumns(header: CellValue[]) {
  const names = header.map((h) => normalizeHeader(String(h ?? "")));
  const cols: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    const idx = names.findIndex((n) => n && HEADER_ALIASES[key].includes(n));
    if (idx >= 0) cols[key] = idx;
  }
  // Tolerancia: encabezados que contienen la palabra clave ("peso (kg)" ya está
  // normalizado a "peso kg"; "id electronico" contiene "id").
  if (cols.eid === undefined) cols.eid = names.findIndex((n) => /(^| )(ide|eid|caravana|rfid)( |$)/.test(n));
  if (cols.weight === undefined) cols.weight = names.findIndex((n) => /(^| )(peso|kg|weight)( |$)/.test(n));
  if (cols.date === undefined) cols.date = names.findIndex((n) => /^fecha/.test(n));
  for (const k of Object.keys(cols) as (keyof typeof cols)[]) if (cols[k]! < 0) delete cols[k];
  return cols;
}

function cellText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    // Evita notación científica para caravanas leídas como número.
    return Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v);
  }
  return String(v).trim();
}

function normalizeEid(v: CellValue): string {
  let s = cellText(v).replace(/[\s.-]/g, "");
  // "8.58000058652927E14" u otras variantes exportadas como float.
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) {
    try {
      s = BigInt(Math.round(Number(s))).toString();
    } catch {
      /* se deja tal cual */
    }
  }
  return s;
}

function parseWeight(v: CellValue): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? D(v).toFixed() : null;
  const s = String(v).trim().replace(/\s*kg$/i, "");
  // "1.234,5" -> "1234.5"; "347,5" -> "347.5"
  const normalized =
    s.includes(",") && s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  return D(normalized).toFixed();
}

function parseMode(v: CellValue): "lector" | "manual" {
  const s = normalizeHeader(cellText(v));
  return ["manual", "si", "s", "true", "1", "yes", "tipeado"].includes(s) ? "manual" : "lector";
}

export type ParseResult = {
  sheetName: string | null;
  columns: Record<string, number>;
  rows: ParsedRow[];
  warnings: string[];
};

export function parseWeighingRows(table: CellValue[][], sheetName: string | null = null): ParseResult {
  // Salta filas vacías iniciales hasta encontrar el encabezado.
  let headerIdx = table.findIndex((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  if (headerIdx < 0) throw new Error("El archivo está vacío.");
  // El encabezado es la primera fila que contiene la columna de caravana o peso.
  for (let i = headerIdx; i < Math.min(table.length, headerIdx + 10); i++) {
    const cols = findColumns(table[i]);
    if (cols.eid !== undefined && cols.weight !== undefined) {
      headerIdx = i;
      break;
    }
  }
  const columns = findColumns(table[headerIdx]);
  if (columns.eid === undefined || columns.weight === undefined) {
    throw new Error("No encontramos las columnas de caravana (IDE) y peso. Revisá el encabezado del archivo.");
  }
  const warnings: string[] = [];
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i] || [];
    const empty = r.every((c) => c === null || c === undefined || String(c).trim() === "");
    if (empty) continue;
    const eid = normalizeEid(r[columns.eid]);
    const weight = parseWeight(r[columns.weight] ?? null);
    const parsedDate = columns.date !== undefined ? parseReaderDate(r[columns.date]) : null;
    const time =
      columns.time !== undefined && r[columns.time] ? cellText(r[columns.time]) : parsedDate?.time ?? null;
    rows.push({
      line: i + 1,
      eid,
      weight,
      date: parsedDate?.date ?? null,
      time,
      mode: columns.mode !== undefined ? parseMode(r[columns.mode]) : "lector",
      observation: columns.observation !== undefined ? cellText(r[columns.observation]) || null : null,
      sex: columns.sex !== undefined ? cellText(r[columns.sex]) || null : null,
    });
  }
  if (!rows.length) throw new Error("El archivo no tiene filas de animales.");
  if (rows.length > 20000) throw new Error("Importá hasta 20.000 filas por archivo.");
  if (columns.date === undefined) warnings.push("El archivo no tiene columna de fecha; se usará la fecha de la sesión.");
  return { sheetName, columns: columns as Record<string, number>, rows, warnings };
}

/** Detecta el formato por nombre/contenido y parsea. `data` es el archivo completo. */
export function parseWeighingFile(data: ArrayBuffer | Uint8Array, fileName: string): ParseResult {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(fileName)) {
    const sheet = readFirstSheet(bytes);
    return parseWeighingRows(sheet.rows, sheet.name);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return parseWeighingRows(parseCsv(text), null);
}

// ---------- Paso 2: validar contra el estado del campo ----------

export type IssueCode =
  | "caravana_invalida"
  | "peso_invalido"
  | "duplicado"
  | "no_registrado"
  | "inactivo"
  | "fuera_de_rango"
  | "variacion_alta"
  | "manual"
  | "sin_fecha"
  | "sexo_distinto";

export const BLOCKING_ISSUES: IssueCode[] = ["caravana_invalida", "peso_invalido", "inactivo"];

export type KnownAnimal = {
  id: string;
  eid: string;
  status: string;
  category: Category | string;
  sex?: string | null; // macho | hembra | sin_dato
  lotId: string | null;
  lastWeight: string | null;
  lastDate: string | null; // YYYY-MM-DD
};

export type ValidationContext = {
  animals: Map<string, KnownAnimal>; // por eid
  sessionDate: string;
  previousFileHashes?: Set<string>;
  previousRowsHashes?: Set<string>;
  fileHash?: string;
  rowsHash?: string;
};

export type ValidatedRow = ParsedRow & {
  issues: IssueCode[];
  messages: string[];
  animalId: string | null;
  category: string | null;
  lotId: string | null;
  previousWeight: string | null;
  previousDate: string | null;
  isNew: boolean;
  duplicateOf: number | null; // línea de la última aparición de la caravana
  defaultAction: "include" | "discard";
  // Sexo leído del archivo (null si el lector no lo cargó) y el registrado en el campo.
  fileSex: Exclude<Sex, "sin_dato"> | null;
  currentSex: string | null;
  // El animal ya tiene sexo y el archivo dice otro: el usuario decide si cambiarlo.
  sexConflict: boolean;
  // El animal no tenía sexo cargado y el archivo lo trae: se completa sin preguntar.
  sexFill: boolean;
};

export type ValidationSummary = {
  total: number;
  valid: number;
  withIssues: number;
  newAnimals: number;
  duplicates: number;
  blocking: number;
  sexConflicts: number; // caravanas distintas con sexo distinto al registrado
  warnings: string[];
  alreadyImported: boolean;
};

export function validateRows(rows: ParsedRow[], ctx: ValidationContext) {
  const lastLineByEid = new Map<string, number>();
  for (const r of rows) lastLineByEid.set(r.eid, r.line);
  const warnings: string[] = [];
  let alreadyImported = false;
  if (ctx.fileHash && ctx.previousFileHashes?.has(ctx.fileHash)) {
    alreadyImported = true;
    warnings.push("Este archivo ya fue importado en una sesión anterior.");
  } else if (ctx.rowsHash && ctx.previousRowsHashes?.has(ctx.rowsHash)) {
    alreadyImported = true;
    warnings.push("Las filas de este archivo coinciden con una sesión ya importada.");
  }
  const out: ValidatedRow[] = rows.map((r) => {
    const issues: IssueCode[] = [];
    const messages: string[] = [];
    const animal = ctx.animals.get(r.eid);
    if (!EID_REGEX.test(r.eid)) {
      issues.push("caravana_invalida");
      messages.push("La caravana debe tener 15 dígitos.");
    }
    const w = r.weight === null ? null : D(r.weight);
    if (w === null || !w.isFinite() || w.lte(0)) {
      issues.push("peso_invalido");
      messages.push("Peso ausente o no válido.");
    } else if (w.lt(ABSOLUTE_WEIGHT_RANGE[0]) || w.gt(ABSOLUTE_WEIGHT_RANGE[1])) {
      issues.push("peso_invalido");
      messages.push(`Peso fuera del rango absoluto (${ABSOLUTE_WEIGHT_RANGE[0]}–${ABSOLUTE_WEIGHT_RANGE[1]} kg).`);
    }
    const dupLine = lastLineByEid.get(r.eid);
    const isDup = dupLine !== undefined && dupLine !== r.line;
    if (isDup) {
      issues.push("duplicado");
      messages.push(`Caravana repetida en el archivo; se conserva la fila ${dupLine} por defecto.`);
    }
    if (!animal) {
      if (!issues.includes("caravana_invalida")) {
        issues.push("no_registrado");
        messages.push("Caravana no registrada en el campo.");
      }
    } else if (animal.status !== "activo") {
      issues.push("inactivo");
      messages.push(`El animal figura como ${animal.status}.`);
    } else if (w && w.gt(0)) {
      const range = WEIGHT_RANGES[animal.category as Category];
      if (range && (w.lt(range[0]) || w.gt(range[1]))) {
        issues.push("fuera_de_rango");
        messages.push(`Peso poco habitual para ${animal.category} (${range[0]}–${range[1]} kg).`);
      }
      if (animal.lastWeight && animal.lastDate) {
        const days = Math.abs(daysBetween(animal.lastDate, r.date || ctx.sessionDate));
        const diff = w.minus(animal.lastWeight).abs();
        const limit = days === 0 ? MAX_SAME_DAY_VARIATION : Math.max(MAX_SAME_DAY_VARIATION, days * MAX_DAILY_VARIATION);
        if (diff.gt(limit)) {
          issues.push("variacion_alta");
          messages.push(`Variación de ${diff.toFixed(0)} kg respecto a ${animal.lastWeight} kg (${animal.lastDate}).`);
        }
      }
    }
    if (r.mode === "manual") {
      issues.push("manual");
      messages.push("Tipeado a mano en el lector; se marca como menos confiable.");
    }
    if (!r.date) issues.push("sin_fecha");
    const fileSex = parseSex(r.sex);
    const currentSex = animal?.sex ?? null;
    const active = !!animal && animal.status === "activo";
    const sexConflict = active && !!fileSex && (currentSex === "macho" || currentSex === "hembra") && currentSex !== fileSex;
    const sexFill = active && !!fileSex && !sexConflict && currentSex !== fileSex;
    if (sexConflict) {
      issues.push("sexo_distinto");
      messages.push(`En el campo figura como ${SEX_LABELS[currentSex as Sex].toLowerCase()} y el lector dice ${SEX_LABELS[fileSex!].toLowerCase()}.`);
    } else if (sexFill) {
      messages.push(`Se completará el sexo con el del lector: ${SEX_LABELS[fileSex!].toLowerCase()}.`);
    }
    const blocking = issues.some((i) => BLOCKING_ISSUES.includes(i));
    return {
      ...r,
      issues,
      messages,
      animalId: animal?.id ?? null,
      category: animal?.category ?? null,
      lotId: animal?.lotId ?? null,
      previousWeight: animal?.lastWeight ?? null,
      previousDate: animal?.lastDate ?? null,
      isNew: !animal && !issues.includes("caravana_invalida"),
      duplicateOf: isDup ? dupLine! : null,
      defaultAction: blocking || isDup ? "discard" : "include",
      fileSex,
      currentSex,
      sexConflict,
      sexFill,
    };
  });
  const summary: ValidationSummary = {
    total: out.length,
    valid: out.filter((r) => !r.issues.length).length,
    withIssues: out.filter((r) => r.issues.length).length,
    newAnimals: out.filter((r) => r.isNew && !r.duplicateOf).length,
    duplicates: out.filter((r) => r.duplicateOf).length,
    blocking: out.filter((r) => r.issues.some((i) => BLOCKING_ISSUES.includes(i))).length,
    sexConflicts: new Set(out.filter((r) => r.sexConflict).map((r) => r.eid)).size,
    warnings,
    alreadyImported,
  };
  return { rows: out, summary };
}

// ---------- Paso 3: aplicar decisiones del usuario ----------

export type RowDecision = {
  line: number;
  action: "include" | "discard";
  lotId?: string | null; // para animales nuevos
  category?: string | null; // para animales nuevos
  updateSex?: boolean; // ante un conflicto de sexo: true = cambiar al del archivo, false/ausente = mantener
};

export type ResolvedRow = ValidatedRow & {
  action: "include" | "discard";
  lotId: string | null;
  category: string | null;
  // Sexo que quedará registrado en el animal si cambia (conflicto aceptado o dato que faltaba); null si no cambia.
  newSex: Exclude<Sex, "sin_dato"> | null;
};

/**
 * Combina validaciones y decisiones. Lanza si queda alguna fila sin resolver:
 * bloqueantes incluidas, animales nuevos sin lote o duplicados sin elegir.
 */
export function resolveRows(rows: ValidatedRow[], decisions: RowDecision[], defaultLotId: string | null) {
  const byLine = new Map(decisions.map((d) => [d.line, d]));
  const resolved: ResolvedRow[] = rows.map((r) => {
    const d = byLine.get(r.line);
    const action = d?.action ?? r.defaultAction;
    const newSex = action === "include" && r.fileSex && (r.sexFill || (r.sexConflict && d?.updateSex === true)) ? r.fileSex : null;
    return {
      ...r,
      action,
      lotId: d?.lotId ?? r.lotId ?? (r.isNew ? defaultLotId : null),
      category: d?.category ?? r.category,
      newSex,
    };
  });
  const errors: string[] = [];
  const includedEids = new Map<string, number>();
  for (const r of resolved) {
    if (r.action !== "include") continue;
    if (r.issues.some((i) => BLOCKING_ISSUES.includes(i)))
      errors.push(`Fila ${r.line}: ${r.messages[0] || "no se puede incluir"}.`);
    if (r.isNew && !r.lotId) errors.push(`Fila ${r.line}: asigná un lote para crear el animal ${r.eid}.`);
    if (includedEids.has(r.eid)) errors.push(`Fila ${r.line}: la caravana ${r.eid} está incluida más de una vez (fila ${includedEids.get(r.eid)}).`);
    includedEids.set(r.eid, r.line);
  }
  if (!includedEids.size) errors.push("No quedó ninguna fila para importar.");
  return { rows: resolved, errors };
}

/** Hash estable de las filas relevantes (caravana, peso, fecha/hora) para detectar reimportaciones. */
export function rowsFingerprint(rows: ParsedRow[]) {
  return rows
    .map((r) => `${r.eid}|${r.weight ?? ""}|${r.date ?? ""}|${r.time ?? ""}`)
    .sort()
    .join("\n");
}

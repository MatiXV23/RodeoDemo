// Catálogos y constantes de dominio compartidos por servidor y cliente.

export const CATEGORIES = [
  "ternero",
  "ternera",
  "novillo",
  "vaquillona",
  "vaca",
  "toro",
  "otro",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ternero: "Terneros",
  ternera: "Terneras",
  novillo: "Novillos",
  vaquillona: "Vaquillonas",
  vaca: "Vacas",
  toro: "Toros",
  otro: "Otros",
};

export const CATEGORY_COLORS: Record<Category, string> = {
  ternero: "#92b5a2",
  ternera: "#a9c4b0",
  novillo: "#44775b",
  vaquillona: "#cad6aa",
  vaca: "#c99b70",
  toro: "#8b7355",
  otro: "#8b9980",
};

// Rango de peso razonable (kg) por categoría; fuera de rango se advierte, no se bloquea.
export const WEIGHT_RANGES: Record<Category, [number, number]> = {
  ternero: [60, 320],
  ternera: [60, 300],
  novillo: [180, 700],
  vaquillona: [150, 520],
  vaca: [300, 800],
  toro: [400, 1200],
  otro: [30, 1300],
};

export const ABSOLUTE_WEIGHT_RANGE: [number, number] = [1, 1500];
// Variación máxima "normal" entre pesadas consecutivas (kg/día absolutos).
export const MAX_DAILY_VARIATION = 3;
// Variación máxima aceptada el mismo día (kg).
export const MAX_SAME_DAY_VARIATION = 25;

export const SEXES = ["macho", "hembra", "sin_dato"] as const;
export type Sex = (typeof SEXES)[number];
export const SEX_LABELS: Record<Sex, string> = {
  macho: "Macho",
  hembra: "Hembra",
  sin_dato: "Sin dato",
};

/**
 * Interpreta el sexo tal como lo escribe un usuario o el lector de caravanas.
 * Devuelve null cuando no hay dato ("", "0", "sin_dato"): el lector exporta
 * "0" cuando el operario no cargó el sexo.
 */
export function parseSex(v: string | null | undefined): Exclude<Sex, "sin_dato"> | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "sin_dato" || s === "sin dato") return null;
  if (["1", "m", "macho", "male", "toro", "novillo", "ternero"].includes(s)) return "macho";
  if (["2", "h", "f", "hembra", "female", "vaca", "vaquillona", "ternera"].includes(s)) return "hembra";
  return null;
}

export function defaultSexFor(category: string): Sex {
  if (["ternera", "vaquillona", "vaca"].includes(category)) return "hembra";
  if (["ternero", "novillo", "toro"].includes(category)) return "macho";
  return "sin_dato";
}

export const ANIMAL_STATUSES = ["activo", "vendido", "muerto", "transferido"] as const;
export const ANIMAL_STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  vendido: "Vendido",
  muerto: "Muerto",
  transferido: "Transferido",
};

export const ORIGINS = ["compra", "nacimiento", "sin_dato"] as const;
export const ORIGIN_LABELS: Record<string, string> = {
  compra: "Compra",
  nacimiento: "Nacimiento",
  sin_dato: "Sin dato",
};

export const MOVEMENT_TYPES = [
  "compra",
  "venta",
  "nacimiento",
  "muerte",
  "transferencia_lote",
  "transferencia_campo",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  compra: "Compra",
  venta: "Venta",
  nacimiento: "Nacimiento",
  muerte: "Muerte",
  transferencia_lote: "Transferencia entre lotes",
  transferencia_campo: "Transferencia entre campos",
};

export const EXPENSE_CATEGORIES = [
  "sanidad",
  "alimentacion",
  "pasturas",
  "mano_de_obra",
  "servicios",
  "infraestructura",
  "otros",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  sanidad: "Sanidad",
  alimentacion: "Alimentación",
  pasturas: "Pasturas",
  mano_de_obra: "Mano de obra",
  servicios: "Servicios",
  infraestructura: "Infraestructura",
  otros: "Otros",
};
export const PASTURE_SUBTYPES = ["fertilizantes", "semillas", "agroquimicos"] as const;
export const PASTURE_SUBTYPE_LABELS: Record<string, string> = {
  fertilizantes: "Fertilizantes",
  semillas: "Semillas",
  agroquimicos: "Agroquímicos",
};
export const EXPENSE_UNITS = ["kg", "litros", "dosis", "unidades", "horas", "ha", "jornales"] as const;

export const HEALTH_TYPES = ["vacunacion", "desparasitacion", "tratamiento", "enfermedad", "otro"] as const;
export type HealthType = (typeof HEALTH_TYPES)[number];
export const HEALTH_TYPE_LABELS: Record<HealthType, string> = {
  vacunacion: "Vacunación",
  desparasitacion: "Desparasitación",
  tratamiento: "Tratamiento",
  enfermedad: "Enfermedad detectada",
  otro: "Otro",
};
/** Días durante los que una enfermedad detectada se considera vigente si no se registra otra cosa. */
export const DISEASE_ACTIVE_DAYS = 60;

// Reproducción: entore (con toro opcional), diagnóstico de preñez, vacía y parto.
export const REPRO_TYPES = ["entore", "prenez", "vacia", "parto"] as const;
export type ReproType = (typeof REPRO_TYPES)[number];
export const REPRO_TYPE_LABELS: Record<ReproType, string> = {
  entore: "Entore / servicio",
  prenez: "Diagnóstico de preñez",
  vacia: "Diagnóstico: vacía",
  parto: "Parto",
};
/** Duración media de la gestación bovina en días. */
export const GESTATION_DAYS = 283;

export const ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  operator: "Operario",
  viewer: "Lector",
};

export const EID_REGEX = /^\d{15}$/;

/** Normaliza texto para comparar encabezados: minúsculas, sin acentos ni símbolos. */
export function normalizeHeader(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Devuelve la categoría canónica a partir de texto libre (acepta etiquetas y plurales). */
export function parseCategory(input: string | null | undefined): Category {
  const s = normalizeHeader(String(input || ""));
  if (!s) return "otro";
  if (s.startsWith("ternera")) return "ternera";
  if (s.startsWith("ternero")) return "ternero";
  if (s.startsWith("novillo")) return "novillo";
  if (s.startsWith("vaquillona")) return "vaquillona";
  if (s.startsWith("vaca")) return "vaca";
  if (s.startsWith("toro")) return "toro";
  return (CATEGORIES as readonly string[]).includes(s) ? (s as Category) : "otro";
}

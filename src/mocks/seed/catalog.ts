// Datos semilla de la demo: usuarios de prueba, campos, propietarios, potreros,
// gastos y precios de referencia. Fechas expresadas respecto al día en que se
// armó el seed original (ANCHOR); al cargar se corren para que todo quede "al día".

import type { FarmRole } from "@rodeo/shared";

/** Fecha de referencia del seed original: todas las fechas fijas se desplazan a partir de acá. */
export const ANCHOR = "2026-09-20";
export const DEMO_PASSWORD = "rodeo1234";

export type DemoUser = { id: string; name: string; email: string; role: FarmRole; title: string; can: string; avatar: string };

/** Un usuario de prueba por rol (el rol vale en La Esperanza; en El Ombú ver FARM_MEMBERS). */
export const DEMO_USERS: DemoUser[] = [
  { id: "u-martin", name: "Martín González", email: "demo@rodeo.app", role: "owner", title: "Productor y dueño", can: "Ve y hace todo: compras, ventas, costos, equipo y configuración.", avatar: "MG" },
  { id: "u-sofia", name: "Sofía Méndez", email: "admin@rodeo.app", role: "admin", title: "Administradora del campo", can: "Gestiona todo el campo y su equipo, salvo eliminarlo.", avatar: "SM" },
  { id: "u-juan", name: "Juan Pereira", email: "operario@rodeo.app", role: "operator", title: "Encargado de campo", can: "Carga pesadas, sanidad, gastos y movimientos, sin ver montos.", avatar: "JP" },
  { id: "u-carolina", name: "Carolina Silva", email: "contadora@rodeo.app", role: "viewer", title: "Contadora", can: "Consulta toda la información, incluida la económica, sin modificar.", avatar: "CS" },
];

export const FARM_ESPERANZA = "f-esperanza";
export const FARM_OMBU = "f-ombu";

export const FARMS = [
  { id: FARM_ESPERANZA, name: "La Esperanza", location: "Durazno, Uruguay", hectares: 850, createdBy: "u-martin" },
  { id: FARM_OMBU, name: "El Ombú", location: "Flores, Uruguay", hectares: 420, createdBy: "u-martin" },
];

export const FARM_MEMBERS: { farmId: string; userId: string; role: FarmRole }[] = [
  { farmId: FARM_ESPERANZA, userId: "u-sofia", role: "admin" },
  { farmId: FARM_ESPERANZA, userId: "u-juan", role: "operator" },
  { farmId: FARM_ESPERANZA, userId: "u-carolina", role: "viewer" },
  { farmId: FARM_OMBU, userId: "u-sofia", role: "admin" },
  { farmId: FARM_OMBU, userId: "u-carolina", role: "viewer" },
];

export const OWNERS = {
  martin: { name: "Martín González", dicose: "041234567" },
  sucesion: { name: "Sucesión Rodríguez", dicose: "049876543", notes: "Capitalización de terneros" },
};

export const PADDOCKS = {
  pradera: { name: "Potrero 3 · pradera", hectares: 120 },
  natural: { name: "Potrero 7 · campo natural", hectares: 210 },
  verdeo: { name: "Potrero 9 · verdeo de avena", hectares: 85 },
  ombu: { name: "Potrero 1 · campo natural", hectares: 140 },
};

/** Gastos mensuales fijos (se generan para los últimos 7 meses, relativos a hoy). */
export const MONTHLY_EXPENSES = [
  { day: 1, category: "mano_de_obra", description: "Personal de campo", supplier: "Liquidación mensual", quantity: 2, unit: "jornales", total: 2150 },
  { day: 10, category: "servicios", description: "Servicios veterinarios", supplier: "Dra. Lucía Fernández", total: 450 },
];

/** Precios de referencia mensuales en pie (USD/kg) del último semestre, del más viejo al más nuevo. */
export const MONTHLY_PRICES: Record<string, number[]> = {
  novillo: [2.86, 2.9, 2.95, 2.98, 3.03, 3.08],
  vaquillona: [2.78, 2.82, 2.86, 2.9, 2.95, 3.0],
  toro: [2.3, 2.32, 2.35, 2.38, 2.42, 2.45],
  vaca: [2.32, 2.35, 2.38, 2.42, 2.45, 2.48],
  ternero: [4.05, 4.12, 4.18, 4.25, 4.31, 4.38],
};

/**
 * Promedios semanales de ACG (acg.com.uy) de la semana 37 de 2026: ganado gordo en
 * cuarta balanza y reposición en pie. El seed arma la serie hacia atrás desde acá.
 */
export const ACG_WEEK = [
  { category: "novillo", basis: "cuarta_balanza", price: 5.82 },
  { category: "vaca", basis: "cuarta_balanza", price: 5.48 },
  { category: "vaquillona", basis: "cuarta_balanza", price: 5.78 },
  { category: "ternero", basis: "en_pie", price: 4.43 },
  { category: "ternera", basis: "en_pie", price: 4.31 },
  { category: "vaca", basis: "en_pie", price: 2.51 },
] as const;

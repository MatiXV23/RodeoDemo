// Código compartido entre la API, la web y (a futuro) la app móvil:
// dominio, contrato de tipos API ↔ cliente, fechas, decimales y cálculos puros.
export * from "./domain";
export * from "./types";
export * from "./dates";
export * from "./decimal";
export * from "./xlsx";
export * as calc from "./calc";
export * from "./calc/gdp";
export * from "./calc/projection";
export * from "./calc/costs";
export * from "./calc/simulators";
export * from "./calc/repro";
export * from "./import/parse-weighing";

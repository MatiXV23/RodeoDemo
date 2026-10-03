import Decimal from "decimal.js";

// Aritmética exacta para montos, pesos y precios. Todos los cálculos
// financieros pasan por acá; nunca por `number` binario.
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = Decimal.Value | null | undefined;

export const D = (v: Numeric): Decimal => {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  if (typeof v === "string") return new Decimal(v.replace(",", "."));
  return new Decimal(v);
};

export const ZERO = new Decimal(0);

export const sum = (values: Iterable<Numeric>) => {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(D(v));
  return acc;
};

/** Serializa para guardar en columnas `numeric` (texto decimal, sin notación exponencial). */
export const toDb = (v: Numeric, dp = 6): string => D(v).toDecimalPlaces(dp).toFixed();

/** Monto monetario con 2 decimales como texto. */
export const money2 = (v: Numeric): string => D(v).toDecimalPlaces(2).toFixed(2);

/** Número para presentación en JSON (el cliente solo lo muestra). */
export const toNum = (v: Numeric, dp = 4): number => Number(D(v).toDecimalPlaces(dp).toFixed());

export const isPositive = (v: Numeric) => D(v).gt(0);

/** División segura: devuelve 0 si el divisor es cero. */
export const div = (a: Numeric, b: Numeric): Decimal => {
  const d = D(b);
  return d.isZero() ? ZERO : D(a).div(d);
};

// Formato de números y fechas para la interfaz (es-UY).

export const fmt = (n: number | null | undefined, decimals = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "–"
    : n.toLocaleString("es-UY", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const money = (n: number | null | undefined, currency = "US$", decimals = 0) =>
  n === null || n === undefined ? "–" : `${currency} ${fmt(n, decimals)}`;

export const currencySymbol = (code: string) => ({ USD: "US$", UYU: "$", ARS: "AR$", BRL: "R$", EUR: "€" })[code] || code;

export const dateLabel = (v: string | null | undefined, withYear = false) =>
  v
    ? new Date(v.slice(0, 10) + "T12:00:00").toLocaleDateString("es-UY", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
    : "–";

export const dateTimeLabel = (iso: string) =>
  new Date(iso).toLocaleString("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const daysSince = (date: string, today = todayIso()) =>
  Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(date + "T00:00:00Z")) / 86400000);

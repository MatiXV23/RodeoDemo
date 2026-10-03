// Preferencias del panel de demo: errores simulados y modo sin conexión.
// Se observan desde React con useSyncExternalStore.

import { useSyncExternalStore } from "react";

export type DemoSettings = { errors: boolean; errorRate: number; offline: boolean };

const KEY = "rodeo-demo:settings";
const DEFAULTS: DemoSettings = { errors: false, errorRate: 0.15, offline: false };

function read(): DemoSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    // El modo sin conexión no sobrevive a una recarga, para no confundir a quien vuelve.
    return { ...DEFAULTS, ...parsed, offline: false };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = read();
const listeners = new Set<() => void>();

export function getSettings() {
  return state;
}

export function setSettings(patch: Partial<DemoSettings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sin almacenamiento */
  }
  for (const l of listeners) l();
}

export function useSettings() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

// ---------- Conexión simulada ----------

// `navigator.onLine` se redefine para que la app (que lo consulta directamente)
// vea la conexión simulada; los eventos online/offline hacen el resto.
const realOnline = () => {
  const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  return desc?.get ? Boolean(desc.get.call(navigator)) : true;
};

export function installNetworkSimulation() {
  try {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !state.offline && realOnline() });
  } catch {
    /* navegador que no permite redefinirlo: el modo sin conexión solo afecta a la API simulada */
  }
}

export function setSimulatedOffline(offline: boolean) {
  setSettings({ offline });
  window.dispatchEvent(new Event(offline ? "offline" : "online"));
}

export const isSimulatedOffline = () => state.offline || !realOnline();

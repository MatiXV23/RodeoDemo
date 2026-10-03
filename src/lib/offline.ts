// Cola offline: pesajes manuales, gastos y eventos sanitarios cargados sin
// conexión se guardan acá y se sincronizan al volver la red. Cada operación
// lleva un clientId único que el servidor usa para no aplicarla dos veces.
// (Igual que en la app; en la demo el envío pasa por la API simulada.)

import { api } from "./api";

export type QueuedOp = {
  clientId: string;
  farmId: string;
  kind: "manual_weighing" | "expense" | "health_event";
  at: string;
  payload: Record<string, unknown>;
  label: string;
};

export type SyncOutcome = { clientId: string; status: "ok" | "conflicto" | "error" | "duplicado"; message?: string };

const KEY = "rodeo-offline-queue-v1";

export function readQueue(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedOp[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* sin almacenamiento: se pierde la cola, pero no rompe la app */
  }
  window.dispatchEvent(new CustomEvent("rodeo:queue"));
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function enqueue(op: Omit<QueuedOp, "clientId" | "at">) {
  const item: QueuedOp = { ...op, clientId: newId(), at: new Date().toISOString() };
  writeQueue([...readQueue(), item]);
  return item;
}

export function removeFromQueue(clientIds: string[]) {
  writeQueue(readQueue().filter((o) => !clientIds.includes(o.clientId)));
}

export function clearQueue() {
  writeQueue([]);
}

export function queueFor(farmId: string) {
  return readQueue().filter((o) => o.farmId === farmId);
}

let syncing = false;

/**
 * Envía la cola de un campo. Devuelve los resultados; las operaciones
 * aplicadas (o duplicadas) salen de la cola, los conflictos también (última
 * escritura gana: el servidor ya decidió) pero se informan al usuario.
 */
export async function syncQueue(farmId: string): Promise<SyncOutcome[]> {
  if (syncing || !navigator.onLine) return [];
  const ops = queueFor(farmId);
  if (!ops.length) return [];
  syncing = true;
  try {
    const { results } = await api.post<{ results: SyncOutcome[] }>(`/api/farms/${farmId}/sync`, { ops: ops.map(({ clientId, kind, at, payload }) => ({ clientId, kind, at, payload })) });
    const settled = results.filter((r) => r.status !== "error").map((r) => r.clientId);
    removeFromQueue(settled);
    return results;
  } catch {
    return [];
  } finally {
    syncing = false;
  }
}

/** La demo no instala service worker: en un hosting estático dejaría versiones viejas en caché. */
export function registerServiceWorker() {}

// Acciones del panel de demo: entrar como un usuario de prueba, cambiar de
// rol, reiniciar los datos y abrir los enlaces de los correos simulados.

import { setSessionUser } from "@/mocks/core";
import { db } from "@/mocks/db";
import { reseed, ensureDb } from "@/mocks/seed";
import { DEMO_USERS, FARM_ESPERANZA } from "@/mocks/seed/catalog";
import { clearQueue } from "@/lib/offline";
import { setSimulatedOffline } from "./settings";

const FARM_KEY = "rodeo-active-farm";
const SNAPSHOT_KEY = "rodeo-snapshot-cache";
const CHECKLIST_KEY = "rodeo-demo:checklist";

/** Deja como campo activo el que corresponde al usuario (La Esperanza si tiene acceso). */
function pickFarmFor(userId: string) {
  ensureDb();
  const farms = db.farmMembers.filter((m) => m.userId === userId).map((m) => m.farmId);
  let current = "";
  try {
    current = localStorage.getItem(FARM_KEY) || "";
  } catch {
    /* sin almacenamiento */
  }
  const next = farms.includes(current) ? current : farms.includes(FARM_ESPERANZA) ? FARM_ESPERANZA : farms[0] || "";
  try {
    if (next) localStorage.setItem(FARM_KEY, next);
  } catch {
    /* sin almacenamiento */
  }
}

/** Antes de un login con el formulario: que el primer campo sea La Esperanza. */
export function prepareLogin(email: string) {
  ensureDb();
  const user = db.users.find((u) => u.email === email.trim().toLowerCase());
  if (user) pickFarmFor(user.id);
}

/** Cambia de usuario de prueba y recarga la app en la misma pantalla. */
export function switchUser(userId: string) {
  pickFarmFor(userId);
  setSessionUser(userId);
  window.location.reload();
}

export function resetDemo() {
  reseed();
  clearQueue();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(SNAPSHOT_KEY) || k === CHECKLIST_KEY) localStorage.removeItem(k);
    localStorage.setItem(FARM_KEY, FARM_ESPERANZA);
  } catch {
    /* sin almacenamiento */
  }
  setSimulatedOffline(false);
  window.location.hash = "#dashboard";
  window.location.reload();
}

/** Abre el enlace de un correo simulado "como el destinatario": cierra la sesión actual. */
export function openMailLink(link: string) {
  setSessionUser(null);
  window.location.hash = link.replace(/^#/, "");
  window.location.reload();
}

export const demoUsers = DEMO_USERS;
export { CHECKLIST_KEY };

// Núcleo de los servicios simulados: errores HTTP, permisos por rol, sesión y
// contexto de campo. Replica apps/api/src/core (errors, permissions, farm-access).

import type { FarmRole } from "@rodeo/shared";
import { db, demoToday } from "./db";
import type { FarmRow, UserRow } from "./schema";

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Iniciá sesión para continuar.") => new HttpError(401, message);
export const forbidden = (message = "No tenés permisos para esta acción.") => new HttpError(403, message);
export const notFound = (message = "No encontramos el recurso.") => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);

// ---------- Permisos (misma matriz que el servidor) ----------

export type Permission = "read" | "read_money" | "write_operational" | "write_money" | "edit_movements" | "manage_farm" | "delete_farm";

const MATRIX: Record<FarmRole, Permission[]> = {
  owner: ["read", "read_money", "write_operational", "write_money", "edit_movements", "manage_farm", "delete_farm"],
  admin: ["read", "read_money", "write_operational", "write_money", "edit_movements", "manage_farm"],
  operator: ["read", "write_operational"],
  viewer: ["read", "read_money"],
};

export function can(role: FarmRole, permission: Permission) {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function assertCan(role: FarmRole, permission: Permission, message?: string) {
  if (!can(role, permission)) throw forbidden(message);
}

export const ASSIGNABLE_ROLES: FarmRole[] = ["admin", "operator", "viewer"];

// ---------- Sesión simulada ----------

const SESSION_KEY = "rodeo-demo:session";

export type SessionUser = { id: string; email: string; name: string };

export function sessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionUser(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

export function currentUser(): SessionUser | null {
  const id = sessionUserId();
  const u: UserRow | undefined = id ? db.users.find((x) => x.id === id) : undefined;
  return u ? { id: u.id, email: u.email, name: u.name } : null;
}

export function requireUser(): SessionUser {
  const u = currentUser();
  if (!u) throw unauthorized();
  return u;
}

// ---------- Contexto de campo ----------

export type FarmCtx = {
  user: SessionUser;
  farm: FarmRow;
  role: FarmRole;
  today: string;
};

/** Igual que `withFarm` en el servidor: exige sesión y pertenencia al campo. */
export function farmCtx(farmId: string): FarmCtx {
  const user = requireUser();
  const farm = db.farms.find((f) => f.id === farmId);
  if (!farm) throw notFound("El campo no existe.");
  const member = db.farmMembers.find((m) => m.farmId === farmId && m.userId === user.id);
  if (!member) throw forbidden("No tenés acceso a este campo.");
  return { user, farm, role: member.role, today: demoToday() };
}

/** Contexto "de sistema" (seed, planificador): actúa como el usuario indicado con rol de propietario. */
export function systemCtx(farm: FarmRow, user: SessionUser, today = demoToday()): FarmCtx {
  return { user, farm, role: "owner", today };
}

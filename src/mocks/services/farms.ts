// Campos, miembros e invitaciones (port de apps/api/src/services/farms.ts)
// y autenticación simulada (port de apps/api/src/core/auth.ts).

import { toDb, FARM_ROLES, type AlertConfig, type FarmRole } from "@rodeo/shared";
import { db, uuid, nowIso, deleteFarmCascade } from "../db";
import { ASSIGNABLE_ROLES, assertCan, badRequest, conflict, forbidden, notFound, unauthorized, setSessionUser, type FarmCtx, type SessionUser } from "../core";
import { sendMail } from "./mail";
import type { FarmRow } from "../schema";

export type FarmInput = {
  name: string;
  location?: string;
  hectares?: number | string;
  currency?: string;
  weightUnit?: string;
  timezone?: string;
  allocationMethod?: "head_days" | "heads";
  withdrawalPolicy?: "block" | "warn";
  alertConfig?: Partial<AlertConfig>;
};

function validateTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw badRequest("Zona horaria no válida.");
  }
}

const randomToken = () => uuid().replace(/-/g, "") + uuid().replace(/-/g, "").slice(0, 16);

export function createFarm(user: SessionUser, input: FarmInput, id = uuid()) {
  const name = input.name?.trim();
  if (!name) throw badRequest("Ingresá el nombre del campo.");
  const now = nowIso();
  const row: FarmRow = {
    id,
    name,
    location: input.location?.trim() || "",
    hectares: toDb(input.hectares || 0, 2),
    currency: (input.currency || "USD").toUpperCase().slice(0, 3),
    weightUnit: input.weightUnit || "kg",
    areaUnit: "ha",
    timezone: validateTimezone(input.timezone || "America/Montevideo"),
    allocationMethod: input.allocationMethod === "heads" ? "heads" : "head_days",
    withdrawalPolicy: input.withdrawalPolicy === "warn" ? "warn" : "block",
    alertConfig: { staleDays: 30, withdrawalSoonDays: 7, email: false, ...(input.alertConfig || {}) },
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  db.farms.push(row);
  db.farmMembers.push({ farmId: id, userId: user.id, role: "owner", createdAt: now });
  return row;
}

export function updateFarm(ctx: FarmCtx, input: Partial<FarmInput>) {
  assertCan(ctx.role, "manage_farm");
  const patch: Partial<FarmRow> = { updatedAt: nowIso() };
  if (input.name !== undefined) {
    if (!String(input.name).trim()) throw badRequest("El nombre no puede quedar vacío.");
    patch.name = String(input.name).trim();
  }
  if (input.location !== undefined) patch.location = String(input.location ?? "").trim();
  if (input.hectares !== undefined) patch.hectares = toDb(input.hectares || 0, 2);
  if (input.currency) patch.currency = input.currency.toUpperCase().slice(0, 3);
  if (input.weightUnit) patch.weightUnit = input.weightUnit;
  if (input.timezone) patch.timezone = validateTimezone(input.timezone);
  if (input.allocationMethod) patch.allocationMethod = input.allocationMethod === "heads" ? "heads" : "head_days";
  if (input.withdrawalPolicy) patch.withdrawalPolicy = input.withdrawalPolicy === "warn" ? "warn" : "block";
  if (input.alertConfig) {
    const c = { ...ctx.farm.alertConfig, ...input.alertConfig };
    c.staleDays = Math.max(1, Math.min(365, Number(c.staleDays) || 30));
    c.withdrawalSoonDays = Math.max(0, Math.min(90, Number(c.withdrawalSoonDays) || 7));
    c.calvingSoonDays = Math.max(0, Math.min(120, Number(c.calvingSoonDays ?? 30) || 0));
    c.email = Boolean(c.email);
    patch.alertConfig = c;
  }
  Object.assign(ctx.farm, patch);
  return ctx.farm;
}

export function deleteFarm(ctx: FarmCtx) {
  assertCan(ctx.role, "delete_farm", "Solo el propietario puede eliminar el campo.");
  deleteFarmCascade(ctx.farm.id);
}

// ---------- Miembros e invitaciones ----------

export function listMembers(ctx: FarmCtx) {
  const members = db.farmMembers
    .filter((m) => m.farmId === ctx.farm.id)
    .map((m) => {
      const u = db.users.find((x) => x.id === m.userId);
      return { userId: m.userId, name: u?.name || "", email: u?.email || "", role: m.role, since: m.createdAt };
    });
  const now = nowIso();
  const pending = db.invitations.filter((i) => i.farmId === ctx.farm.id && !i.acceptedAt && i.expiresAt > now).map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, createdAt: i.createdAt }));
  return { members, pending };
}

function assertAssignable(role: string): FarmRole {
  if (!ASSIGNABLE_ROLES.includes(role as FarmRole)) throw badRequest("Rol no válido. Usá admin, operator o viewer.");
  return role as FarmRole;
}

const ROLE_NAMES: Record<string, string> = { owner: "propietario", admin: "administrador", operator: "operario", viewer: "lector" };

export function inviteMember(ctx: FarmCtx, input: { email: string; role: string }) {
  assertCan(ctx.role, "manage_farm");
  const email = String(input.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Ingresá un correo válido.");
  const role = assertAssignable(input.role);
  const existingUser = db.users.find((u) => u.email === email);
  if (existingUser && db.farmMembers.some((m) => m.farmId === ctx.farm.id && m.userId === existingUser.id)) throw conflict("Esa persona ya forma parte del campo.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  db.invitations.push({ id: token, farmId: ctx.farm.id, email, role, invitedBy: ctx.user.id, expiresAt, acceptedAt: null, createdAt: nowIso() });
  const link = `#invite=${token}`;
  sendMail({
    to: email,
    subject: `${ctx.user.name} te invitó a ${ctx.farm.name} en Rodeo`,
    text: `Te invitaron a colaborar en el campo "${ctx.farm.name}" con el rol ${ROLE_NAMES[role] || role}. Aceptá la invitación desde este enlace (vence en 7 días).`,
    link,
    kind: "invitacion",
  });
  // La respuesta no incluye el enlace: en la demo el correo simulado lo muestra.
  return { id: token, email, role, expiresAt };
}

export function revokeInvitation(ctx: FarmCtx, invitationId: string) {
  assertCan(ctx.role, "manage_farm");
  db.invitations = db.invitations.filter((i) => !(i.id === invitationId && i.farmId === ctx.farm.id));
}

export function invitationInfo(token: string) {
  const inv = db.invitations.find((i) => i.id === token);
  if (!inv) throw notFound("La invitación no existe.");
  const farm = db.farms.find((f) => f.id === inv.farmId);
  if (!farm) throw notFound("La invitación no existe.");
  return { ...inv, farmName: farm.name, farmId: farm.id };
}

export function acceptInvitation(user: SessionUser, token: string) {
  const inv = invitationInfo(token);
  if (inv.acceptedAt) throw conflict("La invitación ya fue utilizada.");
  if (inv.expiresAt < nowIso()) throw badRequest("La invitación venció. Pedí una nueva.");
  if (inv.email !== user.email.toLowerCase()) throw forbidden(`La invitación fue enviada a ${inv.email}. Iniciá sesión con ese correo para aceptarla.`);
  const row = db.invitations.find((i) => i.id === token)!;
  row.acceptedAt = nowIso();
  if (!db.farmMembers.some((m) => m.farmId === inv.farmId && m.userId === user.id)) db.farmMembers.push({ farmId: inv.farmId, userId: user.id, role: inv.role, createdAt: nowIso() });
  return { farmId: inv.farmId, farmName: inv.farmName, role: inv.role };
}

export function changeMemberRole(ctx: FarmCtx, userId: string, role: string) {
  assertCan(ctx.role, "manage_farm");
  const target = db.farmMembers.find((m) => m.farmId === ctx.farm.id && m.userId === userId);
  if (!target) throw notFound("Esa persona no pertenece al campo.");
  if (target.role === "owner") throw forbidden("El rol del propietario no se puede cambiar desde acá.");
  if (!FARM_ROLES.includes(role as FarmRole) || role === "owner") assertAssignable(role);
  if (ctx.role !== "owner" && role === "admin" && target.role !== "admin") throw forbidden("Solo el propietario puede asignar administradores.");
  target.role = role as FarmRole;
}

export function removeMember(ctx: FarmCtx, userId: string) {
  assertCan(ctx.role, "manage_farm");
  const target = db.farmMembers.find((m) => m.farmId === ctx.farm.id && m.userId === userId);
  if (!target) throw notFound("Esa persona no pertenece al campo.");
  if (target.role === "owner") throw forbidden("No se puede quitar al propietario.");
  if (userId === ctx.user.id) throw badRequest("No podés quitarte a vos mismo.");
  db.farmMembers = db.farmMembers.filter((m) => !(m.farmId === ctx.farm.id && m.userId === userId));
}

// ---------- Autenticación simulada ----------

const normalizeEmail = (e: string) => String(e || "").trim().toLowerCase();

function validateCredentials(email: string, password: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Ingresá un correo válido.");
  if (String(password || "").length < 8) throw badRequest("La contraseña debe tener al menos 8 caracteres.");
}

const publicUser = (u: { id: string; email: string; name: string }): SessionUser => ({ id: u.id, email: u.email, name: u.name });

export function register(input: { email: string; password: string; name: string }) {
  const email = normalizeEmail(input.email);
  const name = String(input.name || "").trim();
  validateCredentials(email, input.password);
  if (!name) throw badRequest("Ingresá tu nombre.");
  if (db.users.some((u) => u.email === email)) throw conflict("Ya existe una cuenta con ese correo.");
  const user = { id: uuid(), email, name, password: input.password, createdAt: nowIso() };
  db.users.push(user);
  // En la demo, crear la cuenta con el correo invitado acepta sus invitaciones pendientes.
  for (const inv of db.invitations.filter((i) => i.email === email && !i.acceptedAt && i.expiresAt > nowIso())) {
    acceptInvitation(publicUser(user), inv.id);
  }
  setSessionUser(user.id);
  return publicUser(user);
}

export function login(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const user = db.users.find((u) => u.email === email);
  if (!user || user.password !== input.password) throw unauthorized("Correo o contraseña incorrectos.");
  setSessionUser(user.id);
  return publicUser(user);
}

/** Entrar como un usuario de prueba con un clic (panel de demo). */
export function loginAs(userId: string) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw notFound("El usuario de prueba no existe.");
  setSessionUser(user.id);
  return publicUser(user);
}

/** Campos del usuario en orden de creación (la API real ordena por nombre; acá el campo principal queda primero). */
export function userFarms(userId: string) {
  const order = new Map(db.farms.map((f, i) => [f.id, i]));
  return db.farmMembers
    .filter((m) => m.userId === userId)
    .map((m) => ({ farm: db.farms.find((f) => f.id === m.farmId)!, role: m.role }))
    .filter((x) => x.farm)
    .sort((a, b) => order.get(a.farm.id)! - order.get(b.farm.id)!);
}

export function requestPasswordReset(emailInput: string) {
  const email = normalizeEmail(emailInput);
  const user = db.users.find((u) => u.email === email);
  if (!user) return;
  const token = randomToken();
  db.passwordResets.push({ id: token, userId: user.id, expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(), usedAt: null, createdAt: nowIso() });
  sendMail({ to: email, subject: "Recuperá tu acceso a Rodeo", text: `Hola ${user.name}. Para elegir una nueva contraseña entrá en el enlace (vence en 2 horas).`, link: `#reset=${token}`, kind: "recuperacion" });
}

export function resetPassword(token: string, password: string) {
  if (String(password || "").length < 8) throw badRequest("La contraseña debe tener al menos 8 caracteres.");
  const reset = db.passwordResets.find((r) => r.id === token && !r.usedAt && r.expiresAt > nowIso());
  if (!reset) throw badRequest("El enlace de recuperación no es válido o venció.");
  const user = db.users.find((u) => u.id === reset.userId);
  if (!user) throw badRequest("El enlace de recuperación no es válido o venció.");
  user.password = password;
  reset.usedAt = nowIso();
  setSessionUser(user.id);
  return user.id;
}

export function changePassword(userId: string, current: string, next: string) {
  const user = db.users.find((u) => u.id === userId);
  if (!user || user.password !== current) throw badRequest("La contraseña actual no es correcta.");
  if (String(next || "").length < 8) throw badRequest("La contraseña debe tener al menos 8 caracteres.");
  user.password = next;
}

export function updateProfile(userId: string, input: { name?: string }) {
  const name = input.name?.trim();
  if (name !== undefined && !name) throw badRequest("El nombre no puede quedar vacío.");
  const user = db.users.find((u) => u.id === userId);
  if (user && name) user.name = name;
}

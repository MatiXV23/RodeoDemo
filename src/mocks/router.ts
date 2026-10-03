// Enrutador de la API simulada: mismas rutas, métodos y respuestas que
// apps/api/src/routes. Cada petición que modifica datos corre "en una
// transacción": si el servicio falla, la base vuelve al estado anterior.

import { db, markDirty, useTables, getFile } from "./db";
import { HttpError, badRequest, forbidden, farmCtx, requireUser, currentUser, setSessionUser } from "./core";
import { ensureDb } from "./seed";
import { farmSnapshot } from "./services/snapshot";
import * as farms from "./services/farms";
import * as lots from "./services/lots";
import * as animals from "./services/animals";
import * as owners from "./services/owners";
import * as weighings from "./services/weighings";
import * as imports from "./services/imports";
import * as movements from "./services/movements";
import * as expenses from "./services/expenses";
import * as health from "./services/health";
import * as prices from "./services/prices";
import * as analytics from "./services/analytics";
import * as alerts from "./services/alerts";
import * as exportsSvc from "./services/exports";
import { applySyncOps, type SyncOp } from "./services/sync";
import { toNum } from "@rodeo/shared";

export type MockFile = { __file: true; fileName: string; contentType: string; bytes: Uint8Array };
export type MockHtml = { __html: true; html: string };

type Req = { params: Record<string, string>; query: URLSearchParams; body: any; form: FormData | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (req: Req) => unknown | Promise<unknown>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; save: "none" | "data" };

const routes: Route[] = [];

function on(method: string, path: string, handler: Handler, save: Route["save"] = method === "GET" ? "none" : "data") {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, pattern, keys, handler, save });
}

const F = "/api/farms/:farmId";
const ctx = (r: Req) => farmCtx(r.params.farmId);
const ok = { ok: true };
const fileOf = async (form: FormData | null, field: string) => {
  const f = form?.get(field);
  return f instanceof File && f.size ? { fileName: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
};

// ---------- Autenticación ----------

on("GET", "/api/auth/me", () => {
  const user = currentUser();
  if (!user) return { user: null, farms: [] };
  return {
    user,
    farms: farms.userFarms(user.id).map((f) => ({ id: f.farm.id, name: f.farm.name, location: f.farm.location, hectares: toNum(f.farm.hectares, 2), currency: f.farm.currency, timezone: f.farm.timezone, role: f.role })),
  };
});
on("PATCH", "/api/auth/me", ({ body }) => (farms.updateProfile(requireUser().id, body || {}), ok));
on("POST", "/api/auth/login", ({ body }) => ({ user: farms.login(body || {}), token: "demo" }), "none");
on("POST", "/api/auth/register", ({ body }) => ({ user: farms.register(body || {}), token: "demo" }));
on("POST", "/api/auth/logout", () => (setSessionUser(null), ok), "none");
on("POST", "/api/auth/forgot", ({ body }) => (farms.requestPasswordReset(body?.email || ""), { ok: true, message: "Si el correo está registrado, vas a recibir un enlace para recuperar el acceso." }));
on("POST", "/api/auth/reset", ({ body }) => (farms.resetPassword(body?.token || "", body?.password || ""), ok));
on("POST", "/api/auth/password", ({ body }) => (farms.changePassword(requireUser().id, body?.current || "", body?.next || ""), ok));

// ---------- Campos e invitaciones ----------

on("POST", "/api/farms", ({ body }) => ({ ...farms.createFarm(requireUser(), body || {}), role: "owner" }));
on("GET", "/api/invitations/:token", ({ params }) => {
  const inv = farms.invitationInfo(params.token);
  return { email: inv.email, role: inv.role, farmName: inv.farmName, expiresAt: inv.expiresAt, accepted: !!inv.acceptedAt };
});
on("POST", "/api/invitations/:token", ({ params }) => farms.acceptInvitation(requireUser(), params.token));

on("GET", F, (r) => {
  const c = ctx(r);
  return { ...c.farm, hectares: toNum(c.farm.hectares, 2), role: c.role };
});
on("PATCH", F, (r) => {
  const c = ctx(r);
  const f = farms.updateFarm(c, r.body || {});
  return { ...f, hectares: toNum(f.hectares, 2), role: c.role };
});
on("DELETE", F, (r) => (farms.deleteFarm(ctx(r)), ok));
on("GET", `${F}/snapshot`, (r) => farmSnapshot(ctx(r)));

// ---------- Equipo ----------

on("GET", `${F}/members`, (r) => farms.listMembers(ctx(r)));
on("POST", `${F}/members`, (r) => farms.inviteMember(ctx(r), r.body || {}));
on("PATCH", `${F}/members/:userId`, (r) => (farms.changeMemberRole(ctx(r), r.params.userId, r.body?.role), ok));
on("DELETE", `${F}/members/:userId`, (r) => (farms.removeMember(ctx(r), r.params.userId), ok));
on("DELETE", `${F}/invitations/:id`, (r) => (farms.revokeInvitation(ctx(r), r.params.id), ok));

// ---------- Potreros y propietarios ----------

on("POST", `${F}/paddocks`, (r) => lots.createPaddock(ctx(r), r.body || {}));
on("DELETE", `${F}/paddocks/:id`, (r) => (lots.deletePaddock(ctx(r), r.params.id), ok));
on("GET", `${F}/owners`, (r) => owners.listOwners(ctx(r)));
on("POST", `${F}/owners`, (r) => owners.createOwner(ctx(r), r.body || {}));
on("PATCH", `${F}/owners/:id`, (r) => owners.updateOwner(ctx(r), r.params.id, r.body || {}));
on("DELETE", `${F}/owners/:id`, (r) => (owners.deleteOwner(ctx(r), r.params.id), ok));

// ---------- Lotes y análisis ----------

on("POST", `${F}/lots`, (r) => lots.createLot(ctx(r), r.body || {}));
on("PATCH", `${F}/lots/:lotId`, (r) => lots.updateLot(ctx(r), r.params.lotId, r.body || {}));
on("DELETE", `${F}/lots/:lotId`, (r) => (lots.deleteLot(ctx(r), r.params.lotId), ok));
on("POST", `${F}/lots/:lotId/close`, (r) => lots.closeLot(ctx(r), r.params.lotId));
on("GET", `${F}/lots/:lotId/report`, (r): MockHtml => ({ __html: true, html: exportsSvc.lotReportHtml(ctx(r), r.params.lotId) }));
on("GET", `${F}/lots/:lotId/sale-simulation`, (r) => {
  const q = r.query;
  return analytics.saleSimulation(ctx(r), r.params.lotId, {
    horizonDays: Number(q.get("horizon")) || undefined,
    stepDays: Number(q.get("step")) || undefined,
    pricePerKg: q.get("price"),
    gdpPerDay: q.get("gdp"),
    dailyCostPerHead: q.get("dailyCost"),
    commissionPct: q.get("commission"),
  });
});
on("GET", `${F}/analytics/compare`, (r) => analytics.compareLots(ctx(r)));
on("POST", `${F}/analytics/purchase-simulation`, (r) => analytics.purchaseSimulation(ctx(r), r.body || {}), "none");

// ---------- Animales ----------

on("POST", `${F}/animals`, (r) => animals.createAnimal(ctx(r), r.body || {}));
on("PATCH", `${F}/animals/bulk`, (r) => animals.bulkUpdateAnimals(ctx(r), r.body || {}));
on("GET", `${F}/animals/:animalId`, (r) => animals.animalTimeline(ctx(r), r.params.animalId));
on("PATCH", `${F}/animals/:animalId`, (r) => animals.updateAnimal(ctx(r), r.params.animalId, r.body || {}));
on("POST", `${F}/animals/:animalId/repro`, (r) => owners.addReproEvent(ctx(r), r.params.animalId, r.body || {}));

// ---------- Pesadas e importación ----------

on("POST", `${F}/weighings/manual`, (r) => weighings.manualWeighing(ctx(r), r.body || {}));
on("POST", `${F}/weighings/average`, (r) => weighings.lotAverageWeighing(ctx(r), r.body || {}));
on("GET", `${F}/weighings/sessions/:id`, (r) => weighings.sessionDetail(ctx(r), r.params.id));
on("DELETE", `${F}/weighings/sessions/:id`, (r) => (weighings.deleteSession(ctx(r), r.params.id), ok));
on("POST", `${F}/imports`, async (r) => {
  const c = ctx(r);
  const file = await fileOf(r.form, "file");
  if (!file) throw badRequest('Adjuntá el archivo del lector en el campo "file".');
  return imports.uploadImport(c, file);
});
on("GET", `${F}/imports/:batchId`, (r) => imports.previewImport(ctx(r), r.params.batchId));
on("DELETE", `${F}/imports/:batchId`, (r) => (imports.discardImport(ctx(r), r.params.batchId), ok));
on("POST", `${F}/imports/:batchId/confirm`, (r) => imports.confirmImport(ctx(r), r.params.batchId, r.body || {}));

// ---------- Movimientos ----------

on("POST", `${F}/movements/purchase`, (r) => movements.registerPurchase(ctx(r), r.body || {}));
on("POST", `${F}/movements/sale`, (r) => (r.body?.preview ? movements.previewSale(ctx(r), r.body) : movements.registerSale(ctx(r), r.body || {})));
on("POST", `${F}/movements/death`, (r) => movements.registerDeath(ctx(r), r.body || {}));
on("POST", `${F}/movements/birth`, (r) => movements.registerBirth(ctx(r), r.body || {}));
on("POST", `${F}/movements/transfer`, (r) => movements.transferBetweenLots(ctx(r), r.body || {}));
on("POST", `${F}/movements/transfer-farm`, (r) => movements.transferBetweenFarms(ctx(r), r.body || {}));
on("GET", `${F}/movements/:id`, (r) => movements.movementDetail(ctx(r), r.params.id));
on("DELETE", `${F}/movements/:id`, (r) => (movements.deleteMovement(ctx(r), r.params.id), ok));

// ---------- Gastos y sanidad ----------

on("POST", `${F}/expenses`, async (r) => {
  const c = ctx(r);
  if (r.form) {
    const input = JSON.parse(String(r.form.get("data") || "{}"));
    input.receipt = await fileOf(r.form, "receipt");
    return expenses.createExpense(c, input);
  }
  return expenses.createExpense(c, r.body || {});
});
on("DELETE", `${F}/expenses/:id`, (r) => (expenses.deleteExpense(ctx(r), r.params.id), ok));
on("POST", `${F}/health/reminders`, (r) => health.createReminder(ctx(r), r.body || {}));
on("PATCH", `${F}/health/reminders/:id`, (r) => (health.completeReminder(ctx(r), r.params.id, r.body?.done !== false), ok));
on("POST", `${F}/health`, (r) => health.createHealthEvent(ctx(r), r.body || {}));
on("DELETE", `${F}/health/:id`, (r) => (health.deleteHealthEvent(ctx(r), r.params.id), ok));

// ---------- Precios ----------

on("GET", `${F}/prices`, (r) => prices.priceSummary(prices.listPrices(ctx(r))));
on("POST", `${F}/prices`, async (r) => {
  const c = ctx(r);
  if (r.form) {
    const file = r.form.get("file");
    if (!(file instanceof File)) throw badRequest('Adjuntá el archivo CSV en el campo "file".');
    return prices.importPricesCsv(c, await file.text(), String(r.form.get("provider") || "") || null);
  }
  return prices.addPrice(c, r.body || {});
});
on("DELETE", `${F}/prices/:id`, (r) => (prices.deletePrice(ctx(r), r.params.id), ok));

// ---------- Alertas, exportaciones, archivos y cola offline ----------

on("GET", `${F}/alerts`, (r) => alerts.computeAlerts(ctx(r)));
on("POST", `${F}/alerts`, (r) => alerts.emailAlertsDigest(ctx(r)));
on("GET", `${F}/export/:kind`, (r): MockFile => {
  const f = exportsSvc.exportData(ctx(r), r.params.kind as exportsSvc.ExportKind, r.query.get("format") === "csv" ? "csv" : "xlsx");
  return { __file: true, fileName: f.fileName, contentType: f.contentType, bytes: f.body };
});
on("GET", `${F}/files`, (r): MockFile => {
  const c = ctx(r);
  const key = r.query.get("key") || "";
  if (!key.startsWith(`farms/${c.farm.id}/`)) throw forbidden("El archivo no pertenece a este campo.");
  const file = getFile(key);
  if (!file) throw new HttpError(404, "En la demo, este archivo solo existe como dato de ejemplo: no hay un archivo real guardado.", { code: "archivo_simulado" });
  return { __file: true, fileName: file.name, contentType: file.type, bytes: file.bytes };
});
on("POST", `${F}/sync`, (r) => ({ results: applySyncOps(ctx(r), Array.isArray(r.body?.ops) ? (r.body.ops as SyncOp[]) : []) }));

// ---------- Despacho ----------

export async function handle(method: string, url: string, init: { body?: unknown; form?: FormData | null } = {}): Promise<unknown> {
  ensureDb();
  const [path, qs] = url.split("?");
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const req: Req = { params, query: new URLSearchParams(qs || ""), body: init.body, form: init.form ?? null };
    const backup = route.save === "data" ? JSON.stringify(db) : null;
    try {
      const result = await route.handler(req);
      // La vista previa de una venta no modifica datos.
      if (route.save === "data" && !(req.body && req.body.preview)) markDirty();
      return result;
    } catch (e) {
      if (backup) useTables(JSON.parse(backup));
      if (e instanceof HttpError) throw e;
      console.error("[demo] error en", method, path, e);
      throw new HttpError(500, (e as Error)?.message || "Error interno de la demo.");
    }
  }
  throw new HttpError(404, `Ruta no disponible en la demo: ${method} ${path}`);
}


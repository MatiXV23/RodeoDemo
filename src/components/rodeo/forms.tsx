import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Search, ShieldCheck, CloudOff, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Btn, Badge, DataTable, Field, Pick } from "./ui";
import { Importer } from "./importer";
import type { Action } from "./views";
import { api, ApiError, farmPath, downloadFile } from "@/lib/api";
import { enqueue } from "@/lib/offline";
import { fmt, money, currencySymbol, dateLabel, todayIso } from "@/lib/format";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  PASTURE_SUBTYPES,
  PASTURE_SUBTYPE_LABELS,
  EXPENSE_UNITS,
  HEALTH_TYPES,
  HEALTH_TYPE_LABELS,
  ROLE_LABELS,
  SEX_LABELS,
  ORIGIN_LABELS,
  REPRO_TYPES,
  REPRO_TYPE_LABELS,
} from "@rodeo/shared";
import { expectedCalvingDate } from "@rodeo/shared";
import type { FarmSnapshot, FarmSummary } from "@rodeo/shared";

const titles: Record<string, string> = {
  manual: "Registrar una pesada",
  average: "Pesada de lote por promedio",
  expense: "Un nuevo gasto",
  health: "Registrar evento sanitario",
  reminder: "Nuevo recordatorio sanitario",
  lot: "Crear un lote",
  editLot: "Editar el lote",
  farm: "Un nuevo establecimiento",
  sale: "Registrar venta",
  purchase: "Registrar compra",
  transfer: "Mover animales entre lotes",
  transferFarm: "Transferir a otro campo",
  death: "Registrar muerte",
  birth: "Registrar nacimiento",
  animal: "Alta de animal",
  editAnimal: "Editar animal",
  repro: "Evento reproductivo",
  owner: "Propietario (DICOSE)",
  editOwner: "Editar propietario",
  invite: "Invitar a una persona",
  import: "Importar una pesada",
  price: "Precio de referencia",
  paddock: "Nuevo potrero",
  record: "Detalle del registro",
};

export type FormsProps = {
  action: Action | null;
  snapshot: FarmSnapshot;
  farms: FarmSummary[];
  online: boolean;
  onClose: () => void;
  onSaved: (message?: string) => void;
  onNewFarm: (farm: FarmSummary) => void;
};

export function ActionDialog(p: FormsProps) {
  const { action, snapshot } = p;
  return (
    <Dialog
      open={!!action}
      onOpenChange={(v) => {
        if (!v) p.onClose();
      }}
    >
      <DialogContent className={`record-dialog ${action?.type === "import" || action?.type === "sale" ? "wide-dialog" : ""}`}>
        <DialogHeader>
          <DialogTitle>{titles[action?.type || ""] || "Nuevo registro"}</DialogTitle>
          <DialogDescription>
            {snapshot.farm.name} · {p.online ? "Demo: los cambios se guardan en este navegador." : "Sin conexión: se guardará en este dispositivo y se sincronizará al volver la red."}
          </DialogDescription>
        </DialogHeader>
        {action &&
          (action.type === "import" ? (
            <Importer farmId={snapshot.farm.id} batchId={action.record || null} onDone={() => p.onSaved()} onClose={p.onClose} />
          ) : action.type === "record" ? (
            <RecordDetail snapshot={snapshot} record={action.record || ""} onSaved={p.onSaved} onClose={p.onClose} />
          ) : (
            <RecordForm key={`${action.type}-${action.animal}-${action.lot}-${action.record}`} {...p} action={action} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Detalle de un registro (con edición/eliminación para administradores) ----------

function RecordDetail({ snapshot, record, onSaved, onClose }: { snapshot: FarmSnapshot; record: string; onSaved: (m?: string) => void; onClose: () => void }) {
  const [kind, id] = record.split(":");
  const cur = currencySymbol(snapshot.farm.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const canEdit = ["owner", "admin"].includes(snapshot.role);
  const lotName = (lid: string | null | undefined) => snapshot.lots.find((l) => l.id === lid)?.name || (lid ? "Lote" : "Campo general");
  const farmId = snapshot.farm.id;
  useEffect(() => {
    if (kind === "movements") api.get<Record<string, unknown>>(farmPath(farmId, `/movements/${id}`)).then(setDetail).catch(() => {});
    if (kind === "sessions") api.get<Record<string, unknown>>(farmPath(farmId, `/weighings/sessions/${id}`)).then(setDetail).catch(() => {});
  }, [kind, id, farmId]);

  async function remove(path: string, label: string) {
    if (!confirm(`¿Eliminar ${label}? Esta acción queda registrada en la auditoría.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(farmPath(farmId, path));
      onSaved("Registro eliminado");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (kind === "expenses") {
    const r = snapshot.expenses.find((e) => e.id === id);
    if (!r) return <p>Registro no disponible.</p>;
    return (
      <>
        <Badge>{EXPENSE_CATEGORY_LABELS[r.category as keyof typeof EXPENSE_CATEGORY_LABELS] || r.category}{r.subcategory ? ` · ${PASTURE_SUBTYPE_LABELS[r.subcategory] || r.subcategory}` : ""}</Badge>
        <h3 className="record-title">{r.description}</h3>
        <dl className="detail-list">
          <Row k="Fecha" v={dateLabel(r.date, true)} />
          <Row k="Proveedor" v={r.supplier || "–"} />
          <Row k="Cantidad" v={r.quantity ? `${fmt(r.quantity, 2)} ${r.unit || ""}` : "–"} />
          <Row k="Precio unitario" v={r.unitPrice !== null ? money(r.unitPrice, cur, 2) : "–"} />
          <Row k="Total" v={r.total !== null ? money(r.total, cur, 2) : "Restringido"} />
          <Row k="Imputación" v={r.allocations.map((a) => `${lotName(a.lotId)} ${a.percentage}%`).join(" · ")} />
          {r.notes && <Row k="Notas" v={r.notes} />}
          {r.receiptKey && (
            <Row
              k="Comprobante"
              v={
                <button className="text-link" onClick={() => downloadFile(farmPath(farmId, `/files?key=${encodeURIComponent(r.receiptKey!)}`), r.receiptName || "comprobante")}>
                  <Download size={14} /> {r.receiptName}
                </button>
              }
            />
          )}
        </dl>
        {canEdit && (
          <div className="form-actions">
            <Btn variant="danger" disabled={busy} onClick={() => remove(`/expenses/${id}`, "este gasto")}>
              Eliminar gasto
            </Btn>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }
  if (kind === "health") {
    const r = snapshot.health.find((e) => e.id === id);
    if (!r) return <p>Registro no disponible.</p>;
    return (
      <>
        <Badge tone={r.withdrawalActive ? "amber" : "green"}>{HEALTH_TYPE_LABELS[r.type as keyof typeof HEALTH_TYPE_LABELS] || r.type}</Badge>
        <h3 className="record-title">{r.product}</h3>
        <dl className="detail-list">
          <Row k="Fecha" v={dateLabel(r.date, true)} />
          <Row k="Aplicado a" v={r.scope === "lote" ? `${r.lotName || "Lote"} completo (${r.animalCount} animales)` : `${r.animalCount} animales seleccionados${r.lotName ? ` · ${r.lotName}` : ""}`} />
          <Row k="Dosis" v={r.dose || "–"} />
          <Row k="Retiro" v={r.withdrawalDays ? `${r.withdrawalDays} días · hasta ${dateLabel(r.withdrawalUntil, true)}${r.withdrawalActive ? " (vigente)" : ""}` : "Sin retiro"} />
          {r.expenseId && <Row k="Gasto vinculado" v={snapshot.expenses.find((e) => e.id === r.expenseId)?.description || r.expenseId} />}
          {r.notes && <Row k="Notas" v={r.notes} />}
        </dl>
        {canEdit && (
          <div className="form-actions">
            <Btn variant="danger" disabled={busy} onClick={() => remove(`/health/${id}`, "este evento sanitario")}>
              Eliminar evento
            </Btn>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }
  if (kind === "movements") {
    const r = snapshot.movements.find((m) => m.id === id);
    if (!r) return <p>Registro no disponible.</p>;
    const heads = (detail?.animals as { eid: string; visualTag: string | null; weight: string | null; amount: string | null }[] | undefined) || [];
    return (
      <>
        <Badge>{r.typeLabel}</Badge>
        <h3 className="record-title">
          {r.headCount} animales{r.counterparty ? ` · ${r.counterparty}` : ""}
        </h3>
        <dl className="detail-list">
          <Row k="Fecha" v={dateLabel(r.date, true)} />
          {r.fromLotId && <Row k="Lote de origen" v={lotName(r.fromLotId)} />}
          {r.toLotId && <Row k="Lote de destino" v={lotName(r.toLotId)} />}
          {r.toFarmId && <Row k="Campo de destino" v={r.counterparty || r.toFarmId} />}
          {r.totalWeight !== null && <Row k="Peso total" v={`${fmt(r.totalWeight)} kg`} />}
          {r.unitPrice !== null && <Row k="Precio" v={`${money(r.unitPrice, cur, 2)} por ${r.priceMode === "kg" ? "kg" : "cabeza"}`} />}
          {r.grossAmount !== null && <Row k="Importe bruto" v={money(r.grossAmount, cur, 2)} />}
          {(r.commission || r.freight) && <Row k="Comisión / flete" v={`${money(r.commission || 0, cur, 2)} / ${money(r.freight || 0, cur, 2)}`} />}
          {r.netAmount !== null && <Row k="Importe neto" v={money(r.netAmount, cur, 2)} />}
          {r.allocatedCost !== null && r.type === "venta" && <Row k="Costo acumulado asignado" v={money(r.allocatedCost, cur, 2)} />}
          {r.result !== null && (
            <Row
              k="Resultado"
              v={
                <span className={r.result >= 0 ? "gain" : "negative"}>
                  {money(r.result, cur, 2)}
                </span>
              }
            />
          )}
          {r.documentRef && <Row k="Documento" v={r.documentRef} />}
          {r.cause && <Row k="Causa" v={r.cause} />}
          {r.notes && <Row k="Notas" v={r.notes} />}
          <Row k="Registrado" v={dateLabel(r.createdAt, true) + (r.updatedAt !== r.createdAt ? ` · modificado ${dateLabel(r.updatedAt, true)}` : "")} />
        </dl>
        {heads.length > 0 && (
          <DataTable headers={["Caravana", "Visual", "Peso", "Importe"]} rows={heads.slice(0, 200).map((h) => [<span className="animal-id" key="e">{h.eid}</span>, h.visualTag || "–", h.weight ? `${fmt(Number(h.weight), 1)} kg` : "–", h.amount ? money(Number(h.amount), cur, 2) : "–"])} />
        )}
        {canEdit && (
          <div className="form-actions">
            <Btn variant="danger" disabled={busy} onClick={() => remove(`/movements/${id}`, "este movimiento (se revierte su efecto sobre los animales)")}>
              Eliminar movimiento
            </Btn>
          </div>
        )}
        <p className="form-note">Los movimientos confirmados son inmutables; solo un administrador puede modificarlos y cada cambio queda en el registro de auditoría.</p>
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }
  if (kind === "sessions") {
    const r = snapshot.sessions.find((s) => s.id === id);
    if (!r) return <p>Registro no disponible.</p>;
    const ws = (detail?.weighings as { id: string; eid: string; visualTag: string | null; weight: number; mode: string; reliable: boolean; observation: string | null; lotName: string | null; weighedAt: string }[] | undefined) || [];
    const session = detail?.session as { fileKey?: string | null } | undefined;
    return (
      <>
        <Badge>{r.origin === "importada" ? "Importada" : r.origin === "promedio" ? "Promedio de lote" : "Manual"}</Badge>
        <h3 className="record-title">{r.name}</h3>
        <dl className="detail-list">
          <Row k="Fecha" v={dateLabel(r.date, true)} />
          <Row k="Animales" v={String(r.count)} />
          <Row k="Peso promedio" v={r.avgWeight !== null ? `${fmt(r.avgWeight, 1)} kg` : "–"} />
          <Row k="Lotes" v={r.lotIds.map(lotName).join(", ") || "–"} />
          {r.notes && <Row k="Notas" v={r.notes} />}
          {session?.fileKey && (
            <Row
              k="Archivo original"
              v={
                <button className="text-link" onClick={() => downloadFile(farmPath(farmId, `/files?key=${encodeURIComponent(session.fileKey!)}`), r.fileName || "pesada.xlsx")}>
                  <Download size={14} /> {r.fileName}
                </button>
              }
            />
          )}
        </dl>
        {ws.length > 0 && (
          <div className="import-table">
            <DataTable
              headers={["Caravana", "Peso", "Lote", "Modo", "Observación"]}
              rows={ws.map((w) => [<span className="animal-id" key="e">{w.eid}</span>, `${fmt(w.weight, 1)} kg`, w.lotName || "–", w.reliable ? (w.mode === "manual" ? "Manual" : "Lector") : <Badge key="m" tone="amber">Tipeado en el lector</Badge>, w.observation || ""])}
            />
          </div>
        )}
        {canEdit && (
          <div className="form-actions">
            <Btn variant="danger" disabled={busy} onClick={() => remove(`/weighings/sessions/${id}`, "esta sesión de pesada completa")}>
              Eliminar sesión
            </Btn>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </>
    );
  }
  return <p>Registro no disponible.</p>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

// ---------- Formularios ----------

const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));

function RecordForm({ action: a, snapshot, farms, online, onClose, onSaved, onNewFarm }: FormsProps & { action: Action }) {
  const farmId = snapshot.farm.id;
  const cur = currencySymbol(snapshot.farm.currency);
  const today = snapshot.today || todayIso();
  const activeLots = snapshot.lots.filter((l) => l.status === "activo");
  const lotOptions = activeLots.map((l) => ({ value: l.id, label: l.name }));
  const editingLot = a.type === "editLot" ? snapshot.lots.find((l) => l.id === a.lot) : undefined;
  const editingAnimal = a.type === "editAnimal" ? snapshot.animals.find((x) => x.id === a.animal) : undefined;
  const reproAnimal = a.type === "repro" ? snapshot.animals.find((x) => x.id === a.animal) : undefined;
  const editingOwner = a.type === "editOwner" ? snapshot.owners.find((o) => o.id === a.record) : undefined;
  const canManage = ["owner", "admin"].includes(snapshot.role);
  const ownerOptions = [{ value: "", label: "Sin propietario" }, ...snapshot.owners.map((o) => ({ value: o.id, label: o.dicose ? `${o.name} · ${o.dicose}` : o.name }))];
  const bullOptions = [{ value: "", label: "Sin toro indicado" }, ...snapshot.animals.filter((x) => x.status === "activo" && x.sex === "macho").map((x) => ({ value: x.id, label: `${x.visual} · ${x.eid}` }))];
  const [lot, setLot] = useState(a.lot || (a.type === "expense" ? "global" : activeLots[0]?.id) || "");
  const [category, setCategory] = useState(
    editingLot?.category || editingAnimal?.category || (["lot", "purchase", "animal"].includes(a.type) ? activeLots.find((l) => l.id === a.lot)?.category || "novillo" : a.type === "expense" ? "alimentacion" : a.type === "price" ? "novillo" : a.type === "health" && a.record ? a.record : "desparasitacion"),
  );
  const [subcategory, setSubcategory] = useState("fertilizantes");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"kg" | "cabeza">("kg");
  const [unit, setUnit] = useState("kg");
  const [selection, setSelection] = useState<string[]>(a.animal ? [a.animal] : []);
  const [search, setSearch] = useState("");
  const [price, setPrice] = useState(String(snapshot.prices[activeLots.find((l) => l.id === (a.lot || activeLots[0]?.id))?.category || "novillo"]?.pricePerKg || ""));
  const [target, setTarget] = useState("");
  const [targetFarm, setTargetFarm] = useState(farms.find((f) => f.id !== farmId)?.id || "");
  const [targetFarmLots, setTargetFarmLots] = useState<{ id: string; name: string }[]>([]);
  const [targetFarmLot, setTargetFarmLot] = useState("");
  const [saved, setSaved] = useState(false);
  const [inviteRole, setInviteRole] = useState("operator");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [entry, setEntry] = useState(a.animal ? snapshot.animals.find((x) => x.id === a.animal)?.eid || "" : "");
  const [weight, setWeight] = useState("");
  const [sex, setSex] = useState(editingAnimal?.sex || "sin_dato");
  const [origin, setOrigin] = useState(editingAnimal?.origin || "compra");
  const [ownerId, setOwnerId] = useState(editingAnimal?.owner?.id || "");
  const [pledged, setPledged] = useState(!!editingAnimal?.pledge);
  const [reproType, setReproType] = useState(reproAnimal?.repro?.inService ? "prenez" : "entore");
  const [reproMonths, setReproMonths] = useState("3");
  const [reproDate, setReproDate] = useState(snapshot.today || todayIso());
  const [bullId, setBullId] = useState(reproAnimal?.repro?.bullId || "");
  const [motherEid, setMotherEid] = useState(a.type === "birth" && a.animal ? snapshot.animals.find((x) => x.id === a.animal)?.eid || "" : "");
  const [healthScope, setHealthScope] = useState<"lote" | "animales">(a.animal ? "animales" : "lote");
  const [allocationMode, setAllocationMode] = useState<"global" | "lot" | "multi">(a.lot ? "lot" : "global");
  const [multiLots, setMultiLots] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ gross: string; net: string; allocatedCost: string; result: string; totalWeight: string; withdrawals: { eid: string; until: string }[]; blocked: boolean; policy: string } | null>(null);
  const [saleWeights, setSaleWeights] = useState<Record<string, string>>({});
  const [ackWithdrawal, setAckWithdrawal] = useState(false);
  const [commission, setCommission] = useState("");
  const [freight, setFreight] = useState("");
  const [priceValue, setPriceValue] = useState("");

  const active = snapshot.animals.filter((an) => an.status === "activo" && an.lot === lot);
  const chosen = active.filter((an) => selection.includes(an.id));
  const totalWeight = chosen.reduce((s, an) => s + (Number(saleWeights[an.id]) || an.weight || 0), 0);
  const selectedLot = snapshot.lots.find((l) => l.id === lot);

  // Vista previa de la venta calculada por el servidor (costos acumulados y retiros).
  useEffect(() => {
    const t = setTimeout(() => {
      if (a.type !== "sale" || !chosen.length || !Number(price) || !online) {
        setPreview(null);
        return;
      }
      api
        .post<NonNullable<typeof preview>>(farmPath(farmId, "/movements/sale"), {
          preview: true,
          animalIds: chosen.map((c) => c.id),
          priceMode: mode,
          unitPrice: price,
          commission: commission || 0,
          freight: freight || 0,
          weights: Object.keys(saleWeights).length ? Object.fromEntries(Object.entries(saleWeights).filter(([, v]) => v)) : undefined,
        })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.type, selection.join(","), price, mode, commission, freight, JSON.stringify(saleWeights), online]);

  useEffect(() => {
    if (a.type !== "transferFarm" || !targetFarm) return;
    api
      .get<FarmSnapshot>(farmPath(targetFarm, "/snapshot"))
      .then((s) => setTargetFarmLots(s.lots.filter((l) => l.status === "activo").map((l) => ({ id: l.id, name: l.name }))))
      .catch(() => setTargetFarmLots([]));
  }, [a.type, targetFarm]);

  const selecting = ["sale", "transfer", "transferFarm", "death"].includes(a.type) || (a.type === "health" && healthScope === "animales");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setErrors([]);
    const d = new FormData(e.currentTarget);
    const get = (k: string) => String(d.get(k) || "");
    const date = get("date") || today;
    setBusy(true);
    try {
      if (a.type === "manual") {
        const payload = { animal: entry.trim(), weight, date, observation: get("observation") || null, confirmAnomalous: !!d.get("confirmWeight") };
        if (!online) {
          enqueue({ farmId, kind: "manual_weighing", payload, label: `Pesada ${entry} · ${weight} kg` });
          onSaved("Pesada guardada en el dispositivo; se sincronizará al volver la conexión.");
        } else {
          await api.post(farmPath(farmId, "/weighings/manual"), payload);
          onSaved("Peso guardado");
        }
        setSaved(true);
        setEntry("");
        setWeight("");
        return;
      }
      if (a.type === "average") {
        await api.post(farmPath(farmId, "/weighings/average"), { lotId: lot, date, headCount: Number(get("headCount")), totalWeight: get("totalWeight"), notes: get("notes") || null });
        onSaved("Pesada de lote registrada");
      }
      if (a.type === "expense") {
        const allocations = allocationMode === "global" ? [] : allocationMode === "lot" ? [{ lotId: lot === "global" ? activeLots[0]?.id : lot }] : multiLots.map((l) => ({ lotId: l }));
        const payload = {
          category,
          subcategory: category === "pasturas" ? subcategory : null,
          description: get("name"),
          supplier: get("supplier") || null,
          date,
          quantity: get("quantity") || null,
          unit,
          unitPrice: get("unitPrice") || null,
          total: get("amount") || null,
          notes: get("notes") || null,
          allocations,
        };
        if (allocationMode === "multi" && !multiLots.length) throw new Error("Seleccioná al menos un lote para imputar.");
        const receipt = d.get("receipt");
        if (!online) {
          enqueue({ farmId, kind: "expense", payload, label: `Gasto ${payload.description}` });
          onSaved("Gasto guardado en el dispositivo; se sincronizará al volver la conexión.");
        } else if (receipt instanceof File && receipt.size) {
          const form = new FormData();
          form.append("data", JSON.stringify(payload));
          form.append("receipt", receipt);
          await api.upload(farmPath(farmId, "/expenses"), form);
          onSaved("Gasto registrado");
        } else {
          await api.post(farmPath(farmId, "/expenses"), payload);
          onSaved("Gasto registrado");
        }
      }
      if (a.type === "health") {
        const payload = {
          type: category,
          product: get("product"),
          dose: get("dose") || null,
          date,
          lotId: healthScope === "lote" ? lot : selectedLot?.id || null,
          animalIds: healthScope === "animales" ? selection : undefined,
          withdrawalDays: Number(get("withdrawal")) || 0,
          notes: get("notes") || null,
          reminder: get("reminderDate") ? { dueDate: get("reminderDate"), title: get("reminderTitle") || null } : null,
        };
        if (healthScope === "animales" && !selection.length) throw new Error("Seleccioná al menos un animal.");
        if (!online) {
          enqueue({ farmId, kind: "health_event", payload, label: `Sanidad ${payload.product}` });
          onSaved("Evento guardado en el dispositivo; se sincronizará al volver la conexión.");
        } else {
          await api.post(farmPath(farmId, "/health"), payload);
          onSaved("Evento sanitario registrado");
        }
      }
      if (a.type === "reminder") {
        await api.post(farmPath(farmId, "/health/reminders"), { title: get("title"), dueDate: get("dueDate"), lotId: lot || null, notes: get("notes") || null });
        onSaved("Recordatorio creado");
      }
      if (a.type === "lot") {
        await api.post(farmPath(farmId, "/lots"), { name: get("name"), category, targetWeight: get("target") || null, startDate: date, paddockId: get("paddock") || null, notes: get("notes") || null });
        onSaved("Lote creado");
      }
      if (a.type === "editLot" && editingLot) {
        await api.patch(farmPath(farmId, `/lots/${editingLot.id}`), { name: get("name"), category, targetWeight: get("target") || null, paddockId: get("paddock") || null, notes: get("notes") || null });
        onSaved("Lote actualizado");
      }
      if (a.type === "paddock") {
        await api.post(farmPath(farmId, "/paddocks"), { name: get("name"), hectares: get("ha") || 0 });
        onSaved("Potrero creado");
      }
      if (a.type === "farm") {
        const farm = await api.post<FarmSummary>("/api/farms", { name: get("name"), location: get("location"), hectares: get("ha") || 0, timezone: get("timezone") || "America/Montevideo", currency: get("currency") || "USD" });
        onNewFarm({ ...farm, role: "owner", lots: 0, animals: 0 });
        onClose();
        return;
      }
      const pledgePayload = canManage ? { pledge: pledged ? { bank: get("bank"), ref: get("pledgeRef") || null, since: get("pledgeSince") || null } : null } : {};
      if (a.type === "animal") {
        if (pledged && !get("bank")) throw new Error("Indicá el banco de la prenda.");
        await api.post(farmPath(farmId, "/animals"), { eid: get("eid"), visualTag: get("visual") || null, category, sex, origin, lotId: lot || null, weight: get("weight") || null, date, breed: get("breed") || null, birthDateEstimated: get("birth") || null, notes: get("notes") || null, ownerId: ownerId || null, ...pledgePayload });
        onSaved("Animal registrado");
      }
      if (a.type === "editAnimal" && editingAnimal) {
        if (pledged && !get("bank")) throw new Error("Indicá el banco de la prenda.");
        await api.patch(farmPath(farmId, `/animals/${editingAnimal.id}`), { visualTag: get("visual") || null, category, sex, origin, breed: get("breed") || null, birthDateEstimated: get("birth") || null, notes: get("notes") || null, ownerId: ownerId || null, ...pledgePayload });
        onSaved("Animal actualizado");
      }
      if (a.type === "repro" && reproAnimal) {
        await api.post(farmPath(farmId, `/animals/${reproAnimal.id}/repro`), { type: reproType, date: reproDate, months: reproType === "prenez" ? reproMonths : null, bullId: reproType === "entore" ? bullId || null : null, notes: get("notes") || null });
        onSaved(`${REPRO_TYPE_LABELS[reproType as keyof typeof REPRO_TYPE_LABELS]} registrado`);
      }
      if (a.type === "owner") {
        await api.post(farmPath(farmId, "/owners"), { name: get("name"), dicose: get("dicose") || null, notes: get("notes") || null });
        onSaved("Propietario creado");
      }
      if (a.type === "editOwner" && editingOwner) {
        await api.patch(farmPath(farmId, `/owners/${editingOwner.id}`), { name: get("name"), dicose: get("dicose") || null, notes: get("notes") || null });
        onSaved("Propietario actualizado");
      }
      if (a.type === "price") {
        await api.post(farmPath(farmId, "/prices"), { category, pricePerKg: priceValue, date, source: "manual" });
        onSaved("Precio guardado");
      }
      if (a.type === "sale") {
        if (!chosen.length) throw new Error("Seleccioná al menos un animal.");
        await api.post(farmPath(farmId, "/movements/sale"), {
          date,
          counterparty: get("counterparty"),
          animalIds: chosen.map((c) => c.id),
          priceMode: mode,
          unitPrice: price,
          commission: commission || 0,
          freight: freight || 0,
          documentRef: get("document") || null,
          notes: get("notes") || null,
          weights: Object.keys(saleWeights).length ? Object.fromEntries(Object.entries(saleWeights).filter(([, v]) => v)) : undefined,
          acknowledgeWithdrawal: ackWithdrawal,
        });
        onSaved("Venta registrada");
      }
      if (a.type === "transfer") {
        if (!chosen.length) throw new Error("Seleccioná al menos un animal.");
        if (!target || target === lot) throw new Error("Seleccioná un lote de destino diferente.");
        await api.post(farmPath(farmId, "/movements/transfer"), { date, animalIds: chosen.map((c) => c.id), toLotId: target, notes: get("notes") || null });
        onSaved("Animales transferidos");
      }
      if (a.type === "transferFarm") {
        if (!chosen.length) throw new Error("Seleccioná al menos un animal.");
        await api.post(farmPath(farmId, "/movements/transfer-farm"), { date, animalIds: chosen.map((c) => c.id), toFarmId: targetFarm, toLotId: targetFarmLot || null, notes: get("notes") || null });
        onSaved("Animales transferidos al otro campo");
      }
      if (a.type === "death") {
        if (!chosen.length) throw new Error("Seleccioná al menos un animal.");
        await api.post(farmPath(farmId, "/movements/death"), { date, animalIds: chosen.map((c) => c.id), cause: get("reason") || null });
        onSaved("Baja registrada");
      }
      if (a.type === "purchase") {
        const lines = get("ids")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const animals = lines.map((l) => {
          const [eid, w] = l.split(/[\s,;]+/);
          return { eid, weight: w || get("purchaseWeight") || null };
        });
        if (!animals.length) throw new Error("Ingresá las caravanas compradas, una por línea.");
        await api.post(farmPath(farmId, "/movements/purchase"), {
          date,
          counterparty: get("counterparty"),
          lotId: lot,
          priceMode: mode,
          unitPrice: price,
          commission: commission || 0,
          freight: freight || 0,
          documentRef: get("document") || null,
          notes: get("notes") || null,
          category,
          ownerId: ownerId || null,
          animals,
        });
        onSaved("Compra registrada");
      }
      if (a.type === "birth") {
        const lines = get("ids")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        await api.post(farmPath(farmId, "/movements/birth"), {
          date,
          lotId: lot,
          animals: lines.map((l) => {
            const [eid, w] = l.split(/[\s,;]+/);
            return { eid, weight: w || null, sex };
          }),
          notes: get("notes") || null,
          motherId: motherEid.trim() || null,
          ownerId: ownerId || null,
        });
        onSaved("Nacimiento registrado");
      }
      if (a.type === "invite") {
        const r = await api.post<{ link?: string }>(farmPath(farmId, "/members"), { email: get("email"), role: inviteRole });
        setInviteLink(r.link || null);
        setSaved(true);
        onSaved("Invitación enviada");
        return;
      }
      onClose();
    } catch (err) {
      const e = err as ApiError;
      setError(e.message);
      const details = (e as ApiError).details as { errors?: string[]; withdrawals?: { eid: string; until: string }[]; code?: string } | null;
      if (details?.errors) setErrors(details.errors);
    } finally {
      setBusy(false);
    }
  }

  const dateField = (
    <Field label="Fecha">
      <input name="date" type="date" defaultValue={today} max={today} required />
    </Field>
  );
  const lotField = (label = "Lote") => (
    <Field label={label}>
      <Pick
        label="Seleccionar lote"
        value={lot}
        onChange={(v) => {
          setLot(v);
          setSelection([]);
          const cat = snapshot.lots.find((l) => l.id === v)?.category;
          if (cat && ["sale", "purchase"].includes(a.type)) setPrice(String(snapshot.prices[cat]?.pricePerKg || price));
        }}
        options={lotOptions}
      />
    </Field>
  );
  const picker = (
    <>
      <div className="animal-picker-heading">
        <strong>Seleccionar animales</strong>
        <button type="button" className="text-link" onClick={() => setSelection(selection.length === active.length ? [] : active.map((an) => an.id))}>
          {selection.length === active.length && active.length ? "Quitar selección" : "Seleccionar todos"}
        </button>
      </div>
      <label className="filter-search">
        <Search size={16} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por caravana" aria-label="Buscar animales para operación" />
      </label>
      <div className="animal-picker">
        {active
          .filter((an) => an.eid.includes(search) || an.visual.includes(search))
          .slice(0, 400)
          .map((an) => (
            <label className="animal-choice" key={an.id}>
              <Checkbox checked={selection.includes(an.id)} onCheckedChange={(v) => setSelection((s) => (v ? [...s, an.id] : s.filter((id) => id !== an.id)))} />
              <span>
                <strong>#{an.visual}</strong>
                <small>
                  {an.eid}
                  {an.withdrawalUntil ? ` · retiro hasta ${dateLabel(an.withdrawalUntil)}` : ""}
                </small>
              </span>
              {a.type === "sale" && selection.includes(an.id) ? (
                <input className="inline-weight" type="number" min="1" step="0.1" placeholder={an.weight ? String(an.weight) : "kg"} value={saleWeights[an.id] || ""} onChange={(e) => setSaleWeights((w) => ({ ...w, [an.id]: e.target.value }))} aria-label={`Peso de venta ${an.eid}`} />
              ) : (
                <strong>{an.weight ? `${fmt(an.weight)} kg` : "sin peso"}</strong>
              )}
            </label>
          ))}
        {!active.length && <p className="form-note">Este lote no tiene animales activos.</p>}
      </div>
      <div className="selection-total">
        {chosen.length} animales seleccionados <strong>{fmt(totalWeight)} kg</strong>
      </div>
    </>
  );

  return (
    <form className="record-form" onSubmit={save}>
      {!online && ["manual", "expense", "health"].includes(a.type) && (
        <div className="notice amber">
          <CloudOff size={18} />
          Sin conexión. El registro se guardará en este dispositivo y se enviará al servidor al recuperar la red.
        </div>
      )}
      {saved && a.type === "manual" && (
        <div className="notice">
          <Check size={18} />
          Peso guardado. Podés registrar el siguiente animal.
        </div>
      )}
      {a.type === "invite" && saved ? (
        <div className="import-summary">
          <Check size={35} />
          <h3>Invitación enviada</h3>
          <p>La persona recibirá un correo con el enlace para unirse al campo con el rol elegido. Vence en 7 días.</p>
          {inviteLink && (
            <p className="form-note">
              Modo de desarrollo (correo por consola). Enlace: <code>{inviteLink}</code>
            </p>
          )}
          <Btn onClick={onClose}>Cerrar</Btn>
        </div>
      ) : (
        <>
          {["average", "health", "sale", "transfer", "transferFarm", "death", "purchase", "birth", "reminder"].includes(a.type) && lotField()}
          {a.type === "manual" && (
            <>
              <Field label="Caravana electrónica (15 dígitos)">
                <input
                  name="eid"
                  value={entry}
                  onChange={(e) => {
                    setEntry(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="Escaneá o escribí la caravana"
                  inputMode="numeric"
                  autoFocus
                  required
                />
              </Field>
              <div className="form-grid">
                <Field label="Peso (kg)">
                  <input className="weight-input" value={weight} onChange={(e) => setWeight(e.target.value)} name="weight" type="number" inputMode="decimal" min="1" max="1500" step="0.1" placeholder="0,0" required />
                </Field>
                {dateField}
              </div>
              <Field label="Observación (opcional)">
                <input name="observation" placeholder="Ej. cojea de la mano derecha" />
              </Field>
              <label className="check-label">
                <input type="checkbox" name="confirmWeight" />
                Confirmo el peso aunque sea poco habitual para la categoría del animal.
              </label>
            </>
          )}
          {a.type === "average" && (
            <>
              <div className="form-grid">
                <Field label="Animales pesados">
                  <input name="headCount" type="number" min="1" defaultValue={selectedLot?.count || 1} required />
                </Field>
                <Field label="Kilos totales">
                  <input name="totalWeight" type="number" min="1" step="0.1" required />
                </Field>
                {dateField}
              </div>
              <Field label="Notas">
                <input name="notes" placeholder="Ej. pesada en balanza de tropa" />
              </Field>
              <p className="form-note">Se registra el promedio del lote sin pesos individuales; sirve para el peso promedio y la evolución, no para la GDP por animal.</p>
            </>
          )}
          {a.type === "expense" && (
            <>
              <Field label="Concepto">
                <input name="name" placeholder="Ej. Ración de terminación" required />
              </Field>
              <div className="form-grid">
                <Field label="Categoría">
                  <Pick label="Categoría del gasto" value={category} onChange={setCategory} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))} />
                </Field>
                {category === "pasturas" && (
                  <Field label="Subtipo">
                    <Pick label="Subtipo de pasturas" value={subcategory} onChange={setSubcategory} options={PASTURE_SUBTYPES.map((s) => ({ value: s, label: PASTURE_SUBTYPE_LABELS[s] }))} />
                  </Field>
                )}
                {dateField}
                <Field label="Proveedor">
                  <input name="supplier" placeholder="Nombre del proveedor" />
                </Field>
                <Field label="Cantidad">
                  <input name="quantity" type="number" min="0" step="0.001" placeholder="1" />
                </Field>
                <Field label="Unidad">
                  <Pick label="Unidad" value={unit} onChange={setUnit} options={[...EXPENSE_UNITS]} />
                </Field>
                <Field label={`Precio unitario (${cur})`}>
                  <input name="unitPrice" type="number" min="0" step="0.0001" placeholder="0,00" />
                </Field>
                <Field label={`Monto total (${cur})`}>
                  <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="Se calcula con cantidad × precio si queda vacío" />
                </Field>
              </div>
              <Field label="Imputar a">
                <Pick label="Imputación" value={allocationMode} onChange={(v) => setAllocationMode(v as "global" | "lot" | "multi")} options={[{ value: "global", label: "Campo general (se prorratea entre lotes)" }, { value: "lot", label: "Un lote" }, { value: "multi", label: "Varios lotes en partes iguales" }]} />
              </Field>
              {allocationMode === "lot" && lotField("Lote")}
              {allocationMode === "multi" && (
                <div className="animal-picker">
                  {activeLots.map((l) => (
                    <label className="animal-choice" key={l.id}>
                      <Checkbox checked={multiLots.includes(l.id)} onCheckedChange={(v) => setMultiLots((m) => (v ? [...m, l.id] : m.filter((x) => x !== l.id)))} />
                      <span>
                        <strong>{l.name}</strong>
                        <small>{l.count} animales</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Field label="Comprobante (opcional)">
                <input name="receipt" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={!online} />
              </Field>
              <Field label="Notas">
                <input name="notes" />
              </Field>
            </>
          )}
          {a.type === "health" && (
            <>
              <div className="form-grid">
                <Field label="Tipo de evento">
                  <Pick label="Tipo de evento sanitario" value={category} onChange={setCategory} options={HEALTH_TYPES.map((t) => ({ value: t, label: HEALTH_TYPE_LABELS[t] }))} />
                </Field>
                {dateField}
              </div>
              <Field label={category === "enfermedad" ? "Enfermedad o afección detectada" : "Producto"}>
                <input name="product" placeholder={category === "enfermedad" ? "Ej. Garrapatas, queratoconjuntivitis" : "Nombre comercial / principio activo"} required />
              </Field>
              <div className="form-grid">
                <Field label="Dosis">
                  <input name="dose" placeholder="Ej. 1 ml / 50 kg" />
                </Field>
                <Field label="Período de retiro (días)">
                  <input name="withdrawal" type="number" min="0" max="365" defaultValue="0" required />
                </Field>
              </div>
              <Field label="Aplicado a">
                <Pick label="Alcance" value={healthScope} onChange={(v) => setHealthScope(v as "lote" | "animales")} options={[{ value: "lote", label: "Todo el lote" }, { value: "animales", label: "Animales seleccionados" }]} />
              </Field>
              {healthScope === "animales" && picker}
              <div className="form-grid">
                <Field label="Recordar próxima dosis (opcional)">
                  <input name="reminderDate" type="date" min={today} />
                </Field>
                <Field label="Título del recordatorio">
                  <input name="reminderTitle" placeholder="Ej. Refuerzo clostridial" />
                </Field>
              </div>
              <Field label="Notas">
                <input name="notes" />
              </Field>
              <p className="form-note">Con período de retiro, los animales quedan marcados como no aptos para venta hasta la fecha calculada.</p>
            </>
          )}
          {a.type === "reminder" && (
            <>
              <Field label="Título">
                <input name="title" placeholder="Ej. Segunda dosis de vacuna" required />
              </Field>
              <div className="form-grid">
                <Field label="Fecha">
                  <input name="dueDate" type="date" min={today} required />
                </Field>
              </div>
              <Field label="Notas">
                <input name="notes" />
              </Field>
            </>
          )}
          {(a.type === "lot" || a.type === "editLot") && (
            <>
              <Field label="Nombre del lote">
                <input name="name" placeholder="Ej. Novillos compra septiembre" defaultValue={editingLot?.name} required />
              </Field>
              <div className="form-grid">
                <Field label="Categoría predominante">
                  <Pick label="Categoría" value={category} onChange={setCategory} options={categoryOptions} />
                </Field>
                {a.type === "lot" && (
                  <Field label="Fecha de creación">
                    <input name="date" type="date" defaultValue={today} max={today} required />
                  </Field>
                )}
                <Field label="Peso objetivo (kg)">
                  <input name="target" type="number" min="1" max="1500" defaultValue={editingLot?.target ?? 450} />
                </Field>
                <Field label="Potrero">
                  <select name="paddock" defaultValue={editingLot?.paddockId || ""}>
                    <option value="">Sin potrero</option>
                    {snapshot.paddocks.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Notas">
                <input name="notes" defaultValue={editingLot?.notes || ""} />
              </Field>
              {a.type === "lot" && <p className="form-note">El lote se creará vacío. Después podés ingresar animales mediante una compra, un alta o una pesada importada.</p>}
            </>
          )}
          {a.type === "paddock" && (
            <div className="form-grid">
              <Field label="Nombre">
                <input name="name" placeholder="Ej. Potrero 3" required />
              </Field>
              <Field label="Hectáreas">
                <input name="ha" type="number" min="0" step="0.1" />
              </Field>
            </div>
          )}
          {a.type === "farm" && (
            <>
              <Field label="Nombre del establecimiento">
                <input name="name" placeholder="Ej. El Ceibo" required />
              </Field>
              <Field label="Ubicación">
                <input name="location" placeholder="Departamento, país" />
              </Field>
              <div className="form-grid">
                <Field label="Superficie (hectáreas)">
                  <input name="ha" type="number" min="0" />
                </Field>
                <Field label="Moneda">
                  <select name="currency" defaultValue="USD">
                    <option value="USD">Dólares (USD)</option>
                    <option value="UYU">Pesos uruguayos (UYU)</option>
                    <option value="ARS">Pesos argentinos (ARS)</option>
                    <option value="BRL">Reales (BRL)</option>
                  </select>
                </Field>
                <Field label="Zona horaria">
                  <input name="timezone" defaultValue="America/Montevideo" />
                </Field>
              </div>
            </>
          )}
          {(a.type === "animal" || a.type === "editAnimal") && (
            <>
              <div className="form-grid">
                <Field label="Caravana electrónica (15 dígitos)">
                  <input name="eid" inputMode="numeric" pattern="\d{15}" placeholder="858000012345001" defaultValue={editingAnimal?.eid} readOnly={!!editingAnimal} required />
                </Field>
                <Field label="Caravana visual">
                  <input name="visual" placeholder="Ej. 101" defaultValue={editingAnimal?.visual} />
                </Field>
                <Field label="Categoría">
                  <Pick label="Categoría" value={category} onChange={setCategory} options={categoryOptions} />
                </Field>
                <Field label="Sexo">
                  <Pick label="Sexo" value={sex} onChange={setSex} options={Object.entries(SEX_LABELS).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Origen">
                  <Pick label="Origen" value={origin} onChange={setOrigin} options={Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Raza">
                  <input name="breed" placeholder="Opcional" defaultValue={editingAnimal?.breed || ""} />
                </Field>
                <Field label="Nacimiento estimado">
                  <input name="birth" type="date" defaultValue={editingAnimal?.birthDate || ""} />
                </Field>
                <Field label="Propietario (DICOSE)">
                  <Pick label="Sin propietario" value={ownerId} onChange={setOwnerId} options={ownerOptions} />
                </Field>
                {a.type === "animal" && (
                  <>
                    <Field label="Lote">
                      <Pick label="Lote" value={lot} onChange={setLot} options={[{ value: "", label: "Sin lote" }, ...lotOptions]} />
                    </Field>
                    <Field label="Peso inicial (kg)">
                      <input name="weight" type="number" min="1" step="0.1" placeholder="Opcional" />
                    </Field>
                    {dateField}
                  </>
                )}
              </div>
              <Field label="Notas">
                <input name="notes" defaultValue={editingAnimal?.notes || ""} />
              </Field>
              {canManage && (
                <>
                  <label className="check-label">
                    <input type="checkbox" checked={pledged} onChange={(e) => setPledged(e.target.checked)} />
                    A nombre del banco (prenda por préstamo)
                  </label>
                  {pledged && (
                    <div className="form-grid">
                      <Field label="Banco">
                        <input name="bank" placeholder="Ej. BROU" defaultValue={editingAnimal?.pledge?.bank || ""} required />
                      </Field>
                      <Field label="Referencia del préstamo">
                        <input name="pledgeRef" placeholder="Opcional" defaultValue={editingAnimal?.pledge?.ref || ""} />
                      </Field>
                      <Field label="Desde">
                        <input name="pledgeSince" type="date" defaultValue={editingAnimal?.pledge?.since || today} />
                      </Field>
                    </div>
                  )}
                </>
              )}
              {!snapshot.owners.length && <p className="form-note">Los propietarios se cargan en Configuración → Propietarios.</p>}
            </>
          )}
          {a.type === "repro" && reproAnimal && (
            <>
              <p className="form-note">
                Caravana <strong>{reproAnimal.visual}</strong> · {reproAnimal.eid}
                {reproAnimal.repro?.pregnant ? ` · preñada, parto estimado ${dateLabel(reproAnimal.repro.expectedCalving, true)}` : reproAnimal.repro?.inService ? ` · en entore desde ${dateLabel(reproAnimal.repro.serviceSince, true)}` : ""}
              </p>
              <div className="form-grid">
                <Field label="Evento">
                  <Pick label="Tipo de evento reproductivo" value={reproType} onChange={setReproType} options={REPRO_TYPES.map((t) => ({ value: t, label: REPRO_TYPE_LABELS[t] }))} />
                </Field>
                <Field label="Fecha">
                  <input type="date" value={reproDate} max={today} onChange={(e) => setReproDate(e.target.value)} required />
                </Field>
                {reproType === "prenez" && (
                  <Field label="Meses de gestación">
                    <input type="number" min="0" max="9" step="0.5" value={reproMonths} onChange={(e) => setReproMonths(e.target.value)} required />
                  </Field>
                )}
                {reproType === "entore" && (
                  <Field label="Toro (opcional)">
                    <Pick label="Toro" value={bullId} onChange={setBullId} options={bullOptions} />
                  </Field>
                )}
              </div>
              {reproType === "prenez" && reproDate && Number(reproMonths) >= 0 && (
                <p className="form-note">
                  Parto estimado: <strong>{dateLabel(expectedCalvingDate(reproDate, Number(reproMonths) || 0), true)}</strong> (gestación de 283 días).
                </p>
              )}
              {reproType === "parto" && <p className="form-note">Para dar de alta el ternero con su caravana usá “Registrar nacimiento” e indicá la madre: el parto queda registrado automáticamente.</p>}
              <Field label="Notas">
                <input name="notes" placeholder="Ej. Tacto veterinario" />
              </Field>
            </>
          )}
          {(a.type === "owner" || a.type === "editOwner") && (
            <>
              <div className="form-grid">
                <Field label="Nombre o razón social">
                  <input name="name" defaultValue={editingOwner?.name || ""} required />
                </Field>
                <Field label="DICOSE">
                  <input name="dicose" placeholder="Número de propietario" defaultValue={editingOwner?.dicose || ""} />
                </Field>
              </div>
              <Field label="Notas">
                <input name="notes" defaultValue={editingOwner?.notes || ""} />
              </Field>
            </>
          )}
          {a.type === "price" && (
            <div className="form-grid">
              <Field label="Categoría">
                <Pick label="Categoría" value={category} onChange={setCategory} options={categoryOptions} />
              </Field>
              <Field label={`Precio por kg en pie (${cur})`}>
                <input type="number" min="0.0001" step="0.0001" value={priceValue} onChange={(e) => setPriceValue(e.target.value)} required />
              </Field>
              {dateField}
            </div>
          )}
          {selecting && a.type !== "health" && picker}
          {["sale", "purchase"].includes(a.type) && (
            <>
              <div className="form-grid">
                <Field label={`Precio (${cur})`}>
                  <input type="number" min="0.0001" step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} required />
                </Field>
                <Field label="Modalidad">
                  <Pick label="Modalidad de precio" value={mode} onChange={(v) => setMode(v as "kg" | "cabeza")} options={[{ value: "kg", label: "Por kg" }, { value: "cabeza", label: "Por cabeza" }]} />
                </Field>
                <Field label={a.type === "sale" ? "Comprador" : "Vendedor"}>
                  <input name="counterparty" required placeholder="Nombre o razón social" />
                </Field>
                {dateField}
                <Field label={`Comisiones (${cur})`}>
                  <input type="number" min="0" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" />
                </Field>
                <Field label={`Flete (${cur})`}>
                  <input type="number" min="0" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Documento / remito">
                  <input name="document" placeholder="Opcional" />
                </Field>
                <Field label="Notas">
                  <input name="notes" />
                </Field>
              </div>
              {a.type === "purchase" && (
                <>
                  <div className="form-grid">
                    <Field label="Categoría de los animales">
                      <Pick label="Categoría" value={category} onChange={setCategory} options={categoryOptions} />
                    </Field>
                    <Field label="Peso promedio de ingreso (kg)">
                      <input name="purchaseWeight" type="number" min="1" max="1500" step="0.1" placeholder="Si no indicás peso por línea" />
                    </Field>
                    <Field label="Propietario (DICOSE)">
                      <Pick label="Sin propietario" value={ownerId} onChange={setOwnerId} options={ownerOptions} />
                    </Field>
                  </div>
                  <Field label="Caravanas (una por línea, opcionalmente seguida del peso)">
                    <textarea name="ids" rows={5} placeholder={"858000012345001 312\n858000012345002 298"} required />
                  </Field>
                  <p className="form-note">Cada caravana se da de alta en el lote con su peso de ingreso como primera pesada. Las comisiones y el flete se reparten en el costo de compra de cada animal.</p>
                </>
              )}
              {a.type === "sale" && (
                <>
                  <p className="form-note">Podés ingresar el peso de venta de cada animal en la lista; si no, se usa su último peso registrado.</p>
                  {preview && (
                    <div className="sale-preview">
                      <div>
                        <span>Valor bruto · {fmt(Number(preview.totalWeight))} kg</span>
                        <strong>{money(Number(preview.gross), cur, 2)}</strong>
                      </div>
                      <div>
                        <span>Ingreso neto</span>
                        <strong>{money(Number(preview.net), cur, 2)}</strong>
                      </div>
                      <div>
                        <span>Costo acumulado asignado</span>
                        <strong>{money(Number(preview.allocatedCost), cur, 2)}</strong>
                      </div>
                      <div>
                        <span>Resultado</span>
                        <strong className={Number(preview.result) >= 0 ? "gain" : "negative"}>{money(Number(preview.result), cur, 2)}</strong>
                      </div>
                    </div>
                  )}
                  <p className="form-note">El costo acumulado incluye compra, gastos directos y prorrateo del campo de cada animal seleccionado.</p>
                  {preview?.withdrawals.length ? (
                    <div className={`notice ${preview.blocked ? "" : "amber"}`}>
                      <ShieldCheck size={18} />
                      <span>
                        <strong>{preview.withdrawals.length} animal(es) con retiro sanitario vigente:</strong> {preview.withdrawals.slice(0, 5).map((w) => `${w.eid} hasta ${dateLabel(w.until)}`).join(", ")}.{" "}
                        {preview.blocked ? "La venta está bloqueada por la política del campo." : "La política del campo permite continuar bajo tu responsabilidad."}
                        {!preview.blocked && (
                          <label className="check-label">
                            <Checkbox checked={ackWithdrawal} onCheckedChange={(v) => setAckWithdrawal(!!v)} /> Entiendo y quiero registrar la venta igual.
                          </label>
                        )}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
          {a.type === "transfer" && (
            <>
              <Field label="Lote de destino">
                <Pick label="Lote de destino" value={target} onChange={setTarget} options={lotOptions.filter((l) => l.value !== lot)} />
              </Field>
              <div className="form-grid">
                {dateField}
                <Field label="Notas">
                  <input name="notes" />
                </Field>
              </div>
            </>
          )}
          {a.type === "transferFarm" && (
            <>
              <div className="form-grid">
                <Field label="Campo de destino">
                  <Pick label="Campo de destino" value={targetFarm} onChange={setTargetFarm} options={farms.filter((f) => f.id !== farmId).map((f) => ({ value: f.id, label: f.name }))} />
                </Field>
                <Field label="Lote de destino">
                  <Pick label="Lote de destino" value={targetFarmLot} onChange={setTargetFarmLot} options={[{ value: "", label: "Sin lote por ahora" }, ...targetFarmLots.map((l) => ({ value: l.id, label: l.name }))]} />
                </Field>
                {dateField}
                <Field label="Notas">
                  <input name="notes" />
                </Field>
              </div>
              <p className="form-note">Los animales pasan al otro campo conservando su historial de pesos y su costo acumulado como base de costo.</p>
            </>
          )}
          {a.type === "death" && (
            <>
              {dateField}
              <Field label="Causa / observaciones">
                <textarea name="reason" rows={3} placeholder="Registrá la causa si se conoce" />
              </Field>
              <div className="notice amber">
                <AlertTriangle size={19} />
                Los animales seleccionados dejarán de figurar en el stock activo y su costo acumulado impacta en el costo por kilo del lote.
              </div>
            </>
          )}
          {a.type === "birth" && (
            <>
              <div className="form-grid">
                {dateField}
                <Field label="Sexo">
                  <Pick label="Sexo" value={sex} onChange={setSex} options={Object.entries(SEX_LABELS).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Madre (caravana, opcional)">
                  <input value={motherEid} onChange={(e) => setMotherEid(e.target.value)} inputMode="numeric" placeholder="858000012345001" list="mothers" />
                  <datalist id="mothers">
                    {snapshot.animals
                      .filter((x) => x.status === "activo" && x.sex === "hembra" && (x.lot === lot || x.repro?.pregnant))
                      .map((x) => (
                        <option key={x.id} value={x.eid}>
                          {x.visual}{x.repro?.pregnant ? ` · parto estimado ${dateLabel(x.repro.expectedCalving)}` : ""}
                        </option>
                      ))}
                  </datalist>
                </Field>
                <Field label="Propietario (si no, el de la madre)">
                  <Pick label="Sin propietario" value={ownerId} onChange={setOwnerId} options={ownerOptions} />
                </Field>
              </div>
              <p className="form-note">Con la madre indicada, el parto queda en su historial reproductivo y los terneros heredan su propietario.</p>
              <Field label="Caravanas de los terneros (una por línea, opcionalmente con peso al nacer)">
                <textarea name="ids" rows={4} placeholder={"858000012345101 32"} required />
              </Field>
              <Field label="Notas">
                <input name="notes" />
              </Field>
            </>
          )}
          {a.type === "invite" && (
            <>
              <Field label="Correo de la persona">
                <input type="email" name="email" placeholder="nombre@campo.com" required />
              </Field>
              <Field label="Rol en este campo">
                <Pick label="Rol de invitación" value={inviteRole} onChange={setInviteRole} options={["operator", "viewer", "admin"].map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              </Field>
              <p className="form-note">
                {inviteRole === "operator" ? "Carga pesadas, gastos, sanidad y movimientos operativos; no ve montos ni análisis económico." : inviteRole === "viewer" ? "Solo lectura de toda la información del campo, incluida la económica." : "Acceso completo al establecimiento, su configuración y su información económica."}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              <AlertTriangle size={17} />
              {error}
            </p>
          )}
          {errors.length > 0 && (
            <ul className="form-error">
              {errors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn type="submit" variant={a.type === "death" ? "danger" : "primary"} disabled={busy || (a.type === "sale" && !!preview?.blocked)}>
              {busy && <Loader2 className="animate-spin" size={16} />}
              {a.type === "manual" ? "Guardar y continuar" : a.type === "sale" ? "Confirmar venta" : a.type === "death" ? "Confirmar baja" : a.type === "invite" ? "Enviar invitación" : "Guardar registro"}
            </Btn>
          </div>
        </>
      )}
    </form>
  );
}


import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Beef,
  CalendarDays,
  Check,
  ChevronRight,
  Download,
  HeartPulse,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  Scale,
  Search,
  ShieldCheck,
  Sprout,
  Target,
  TrendingUp,
  Upload,
  Wallet,
  Printer,
  Trash2,
  Bell,
  CloudOff,
  Baby,
  Landmark,
  Bug,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Btn, Badge, Panel, Metric, Pick, DataTable, Empty, Field } from "./ui";
import { WeightChart, MarketChart, MarginChart } from "./charts";
import { FarmAlerts } from "./alerts";
import { api, ApiError, farmPath, downloadFile, openPage } from "@/lib/api";
import { fmt, money, currencySymbol, dateLabel, daysSince } from "@/lib/format";
import { CATEGORIES, CATEGORY_LABELS, EXPENSE_CATEGORY_LABELS, HEALTH_TYPE_LABELS, ROLE_LABELS, SEX_LABELS, ORIGIN_LABELS, ANIMAL_STATUS_LABELS, PASTURE_SUBTYPE_LABELS } from "@rodeo/shared";
import { AnimalBadges } from "./ui";
import type { FarmSnapshot, FarmSummary, LotView, AnimalView, SessionUserView } from "@rodeo/shared";
import { queueFor, type QueuedOp } from "@/lib/offline";

export type Action = { type: string; lot?: string; animal?: string; record?: string };

export type Perms = { canWrite: boolean; canMoney: boolean; canManage: boolean; canEditMovements: boolean };

export type ViewsProps = {
  page: string;
  snapshot: FarmSnapshot;
  farms: FarmSummary[];
  user: SessionUserView;
  selected: string | null;
  setSelected: (s: string | null) => void;
  onAction: (a: Action) => void;
  onFarm: (id: string) => void;
  onRefresh: (message?: string) => void;
  onNavigate: (p: string) => void;
  perms: Perms;
  online: boolean;
};

const ALL = "Todas las categorías";
const categoryFilterOptions: { value: string; label: string }[] = [{ value: ALL, label: ALL }, ...CATEGORIES.map((c) => ({ value: c as string, label: CATEGORY_LABELS[c] }))];
const catLabel = (c: string) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] || c;

export function WorkspaceViews(p: ViewsProps) {
  switch (p.page) {
    case "lots":
      return <Lots {...p} />;
    case "animals":
      return <Animals {...p} />;
    case "weighings":
      return <Records {...p} kind="sessions" />;
    case "expenses":
      return <Records {...p} kind="expenses" />;
    case "health":
      return <Records {...p} kind="health" />;
    case "movements":
      return <Records {...p} kind="movements" />;
    case "analytics":
      return <Analysis {...p} />;
    case "farms":
      return <Farms {...p} />;
    case "settings":
      return <Configuration {...p} />;
    case "alerts":
      return <AlertsPage {...p} />;
    default:
      return <Help />;
  }
}

function FilterSearch({ value, onChange, placeholder = "Buscar..." }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="filter-search">
      <Search size={17} />
      <input aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

// ---------- Lotes ----------

function Lots(p: ViewsProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState("Activos");
  const lot = p.snapshot.lots.find((l) => l.id === p.selected);
  if (lot) return <LotDetail {...p} lot={lot} />;
  const lots = p.snapshot.lots.filter(
    (l) =>
      l.name.toLowerCase().includes(query.toLowerCase()) &&
      (category === ALL || l.category === category) &&
      (status === "Todos" || (status === "Activos" ? l.status === "activo" : l.status !== "activo")),
  );
  return (
    <>
      <div className="section-toolbar">
        <div className="filters">
          <FilterSearch value={query} onChange={setQuery} placeholder="Buscar un lote..." />
          <Pick label="Categoría" value={category} onChange={setCategory} options={categoryFilterOptions} />
          <Pick label="Estado" value={status} onChange={setStatus} options={["Activos", "Cerrados", "Todos"]} />
        </div>
        {p.perms.canWrite && (
          <Btn variant="primary" onClick={() => p.onAction({ type: "lot" })}>
            <Plus size={16} />
            Crear lote
          </Btn>
        )}
      </div>
      {lots.length ? (
        <div className="lot-cards">
          {lots.map((l) => (
            <button key={l.id} className="lot-card panel" onClick={() => p.setSelected(l.id)}>
              <div className="lot-card-top">
                <span className="lot-symbol" style={{ background: l.color + "18", color: l.color }}>
                  <Layers size={21} />
                </span>
                <Badge tone={l.status === "activo" ? "green" : "gray"}>{l.status === "activo" ? "Activo" : "Cerrado"}</Badge>
              </div>
              <h2>{l.name}</h2>
              <p>
                {l.categoryLabel} · Desde {dateLabel(l.startDate, true)}
                {l.paddockName ? ` · ${l.paddockName}` : ""}
              </p>
              <div className="lot-card-numbers">
                <div>
                  <strong>{l.count}</strong>
                  <span>animales</span>
                </div>
                <div>
                  <strong>
                    {l.weight !== null ? fmt(l.weight) : "–"}
                    <small> kg</small>
                  </strong>
                  <span>peso promedio</span>
                </div>
                <div>
                  <strong className="gain">{l.gain !== null ? fmt(l.gain, 2) : "–"}</strong>
                  <span>kg / día</span>
                </div>
              </div>
              {l.target ? (
                <>
                  <div className="target-caption">
                    <span>Peso objetivo</span>
                    <strong>{fmt(l.target)} kg</strong>
                  </div>
                  <div className="target-track">
                    <span style={{ width: Math.min(100, ((l.weight || 0) / l.target) * 100) + "%", background: l.color }} />
                  </div>
                </>
              ) : null}
              <div className="lot-card-footer">
                <span>{l.lastWeighingDate ? `Última pesada · ${dateLabel(l.lastWeighingDate)}` : "Sin pesadas"}</span>
                <ArrowRight size={17} />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Panel>
          <Empty
            title="No hay lotes para mostrar"
            description={p.snapshot.lots.length ? "Probá con otros filtros." : "Creá un lote y empezá a registrar tu rodeo."}
            action={
              p.perms.canWrite ? (
                <Btn onClick={() => p.onAction({ type: "lot" })}>
                  <Plus size={16} />
                  Crear lote
                </Btn>
              ) : undefined
            }
          />
        </Panel>
      )}
    </>
  );
}

function LotDetail(p: ViewsProps & { lot: LotView }) {
  const l = p.lot;
  const cur = currencySymbol(p.snapshot.farm.currency);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const closed = l.status !== "activo";
  const c = l.costs;
  const lotName = (id: string | null) => p.snapshot.lots.find((x) => x.id === id)?.name || "Campo general";
  const timeline = useMemo(() => {
    const items: { id: string; date: string; kind: string; title: string; detail: string; record?: string }[] = [];
    for (const s of p.snapshot.sessions) if (s.lotIds.includes(l.id)) items.push({ id: "s" + s.id, date: s.date, kind: "Pesada", title: s.name, detail: `${s.count} animales${s.avgWeight ? ` · ${fmt(s.avgWeight, 1)} kg promedio` : ""}`, record: `sessions:${s.id}` });
    for (const h of p.snapshot.health) if (h.lotId === l.id) items.push({ id: "h" + h.id, date: h.date, kind: "Sanidad", title: `${HEALTH_TYPE_LABELS[h.type as keyof typeof HEALTH_TYPE_LABELS] || h.type} · ${h.product}`, detail: `${h.animalCount} animales${h.withdrawalDays ? ` · retiro ${h.withdrawalDays} días` : ""}`, record: `health:${h.id}` });
    for (const m of p.snapshot.movements) if (m.fromLotId === l.id || m.toLotId === l.id) items.push({ id: "m" + m.id, date: m.date, kind: m.typeLabel, title: `${m.headCount} animales${m.counterparty ? ` · ${m.counterparty}` : ""}`, detail: m.netAmount !== null ? money(m.netAmount, cur) : m.cause || "", record: `movements:${m.id}` });
    for (const e of p.snapshot.expenses) if (e.allocations.some((a) => a.lotId === l.id)) items.push({ id: "e" + e.id, date: e.date, kind: "Gasto", title: e.description, detail: e.total !== null ? money(e.total, cur) : EXPENSE_CATEGORY_LABELS[e.category as keyof typeof EXPENSE_CATEGORY_LABELS], record: `expenses:${e.id}` });
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [p.snapshot, l.id, cur]);

  async function closeLot() {
    if (!confirm(`¿Cerrar el lote "${l.name}"? Se guardará su resultado final y quedará en solo lectura.`)) return;
    setBusy(true);
    try {
      await api.post(farmPath(p.snapshot.farm.id, `/lots/${l.id}/close`));
      p.onRefresh("Lote cerrado con su resultado final");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteLot() {
    if (!confirm(`¿Eliminar el lote "${l.name}"? Solo es posible si nunca tuvo animales.`)) return;
    try {
      await api.delete(farmPath(p.snapshot.farm.id, `/lots/${l.id}`));
      p.setSelected(null);
      p.onRefresh("Lote eliminado");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const animals = p.snapshot.animals.filter((a) => a.lot === l.id && a.status === "activo");
  return (
    <>
      <button className="back-link" onClick={() => p.setSelected(null)}>
        <ArrowLeft size={15} />
        Volver a los lotes
      </button>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">DETALLE DEL LOTE</span>
          <h2>
            {l.name}
            <Badge tone={closed ? "gray" : "green"}>{closed ? "Cerrado" : "Activo"}</Badge>
          </h2>
          <p>
            {l.categoryLabel} · Desde {dateLabel(l.startDate, true)}
            {l.paddockName ? ` · ${l.paddockName}` : ""}
            {l.avgDaysInLot !== null ? ` · ${l.avgDaysInLot} días promedio en el lote` : ""}
          </p>
        </div>
        <div className="detail-actions">
          {p.perms.canWrite && !closed && (
            <>
              <Btn onClick={() => p.onAction({ type: "editLot", lot: l.id })}>
                <Pencil size={15} />
                Editar
              </Btn>
              <Btn onClick={() => p.onAction({ type: "manual", lot: l.id })}>
                <Scale size={16} />
                Registrar pesada
              </Btn>
              {p.perms.canMoney && (
                <Btn variant="primary" onClick={() => p.onAction({ type: "sale", lot: l.id })}>
                  Registrar venta
                  <ArrowUpRight size={16} />
                </Btn>
              )}
            </>
          )}
          {p.perms.canMoney && (
            <Btn onClick={() => openPage(farmPath(p.snapshot.farm.id, `/lots/${l.id}/report`))}>
              <Printer size={15} />
              Informe
            </Btn>
          )}
        </div>
      </div>
      {closed && (
        <div className="notice">
          <ShieldCheck size={19} />
          <span>
            Este lote está cerrado desde el {dateLabel(l.closedAt, true)}. Su historial queda disponible en modo de solo lectura.
            {l.closingResult && (
              <strong>
                {" "}
                Resultado final: {money(Number(l.closingResult.result), cur, 2)} · {fmt(Number(l.closingResult.kgProduced))} kg producidos · {l.closingResult.soldHeads} vendidos · {l.closingResult.deadHeads} muertes.
              </strong>
            )}
          </span>
        </div>
      )}
      <div className="metric-grid">
        <Metric label={closed ? "Animales vendidos" : "Composición actual"} value={fmt(closed ? l.soldHeads : l.count)} unit="animales" icon={<Beef size={19} />} foot={closed ? `${l.deadHeads} muertes` : Object.entries(l.categoryCounts).map(([k, v]) => `${v} ${catLabel(k).toLowerCase()}`).join(" · ") || l.categoryLabel} />
        <Metric label="Peso promedio" value={l.weight !== null ? fmt(l.weight, 1) : "–"} unit="kg" icon={<Scale size={19} />} foot={l.lastWeighingDate ? `Última pesada: ${dateLabel(l.lastWeighingDate, true)}` : "Sin pesadas registradas"} />
        <Metric label="Ganancia diaria" value={l.gain !== null ? fmt(l.gain, 2) : "–"} unit="kg/día" icon={<TrendingUp size={19} />} foot={l.trendGain !== null ? `Tendencia: ${fmt(l.trendGain, 2)} kg/día` : "Promedio ponderado del período"} />
        <Metric label="Kilos producidos" value={fmt(l.kgProduced)} unit="kg" icon={<Sprout size={19} />} foot="Ganancia registrada dentro del lote" />
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="page-tabs" variant="line">
          <TabsTrigger value="overview">Resumen y evolución</TabsTrigger>
          <TabsTrigger value="animals">Animales ({animals.length})</TabsTrigger>
          {p.perms.canMoney && <TabsTrigger value="costs">Costos y resultado</TabsTrigger>}
          <TabsTrigger value="history">Actividad</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="detail-grid">
            <Panel title="Un rodeo que sigue creciendo" subtitle="Peso promedio por sesión de pesada">
              <div className="chart-stat">
                <strong>
                  {l.weight !== null ? fmt(l.weight) : "–"} <small>kg / animal</small>
                </strong>
                {l.target ? <Badge>Objetivo: {fmt(l.target)} kg</Badge> : null}
              </div>
              <WeightChart points={l.history.map((h) => ({ date: h.date, weight: h.avgWeight, count: h.count }))} target={l.target} />
              <div className="chart-footer">{l.history.length} sesiones de pesada registradas</div>
            </Panel>
            {closed ? (
              <Panel className="projection" title="Ciclo finalizado" subtitle="Resultado conservado en el historial">
                <div className="projection-icon">
                  <ShieldCheck size={24} />
                </div>
                <h3>Cerrado</h3>
                <p>
                  Peso final: {l.weight !== null ? fmt(l.weight) : "–"} kg por animal. Último registro: {dateLabel(l.lastWeighingDate)}.
                </p>
                <small>Consultá la actividad y el resultado económico final en las pestañas del lote.</small>
              </Panel>
            ) : (
              <Panel className="projection" title="El próximo paso" subtitle="Proyección con la GDP de tendencia">
                <div className="projection-icon">
                  <Target size={24} />
                </div>
                <h3>
                  {l.projection.daysToTarget === null ? (l.target ? "Sin GDP suficiente" : "Sin peso objetivo") : l.projection.daysToTarget === 0 ? "Objetivo alcanzado" : `${l.projection.daysToTarget} días para el objetivo`}
                </h3>
                <p>
                  A {fmt(l.projection.gdpUsed || 0, 2)} kg/día ({l.projection.gdpSource}):{" "}
                  {l.projection.points.map((pt) => `${pt.days} d → ${fmt(pt.weight)} kg`).join(" · ")}.
                </p>
                {p.perms.canMoney && (
                  <Btn onClick={() => p.onNavigate("analytics")}>
                    Simular una venta
                    <ArrowRight size={15} />
                  </Btn>
                )}
                <small>Supone GDP constante. No incluye variaciones de precio o clima.</small>
              </Panel>
            )}
          </div>
          {!closed && p.perms.canWrite && (
            <div className="action-strip">
              <h3>Registrar en este lote</h3>
              <Btn onClick={() => p.onAction({ type: "average", lot: l.id })}>
                <Scale size={16} />
                Pesada promedio
              </Btn>
              <Btn onClick={() => p.onAction({ type: "expense", lot: l.id })}>
                <Receipt size={16} />
                Gasto
              </Btn>
              <Btn onClick={() => p.onAction({ type: "health", lot: l.id })}>
                <HeartPulse size={16} />
                Evento sanitario
              </Btn>
              <Btn onClick={() => p.onAction({ type: "transfer", lot: l.id })}>
                <ArrowRight size={16} />
                Mover animales
              </Btn>
              {p.farms.length > 1 && <Btn onClick={() => p.onAction({ type: "transferFarm", lot: l.id })}>Transferir a otro campo</Btn>}
              <Btn onClick={() => p.onAction({ type: "birth", lot: l.id })}>Nacimiento</Btn>
              <Btn onClick={() => p.onAction({ type: "death", lot: l.id })}>Registrar muerte</Btn>
              {l.count === 0 && (
                <Btn variant="danger" onClick={closeLot} disabled={busy}>
                  Cerrar lote
                </Btn>
              )}
              {l.count === 0 && l.history.length === 0 && p.perms.canManage && (
                <Btn onClick={deleteLot}>
                  <Trash2 size={15} />
                  Eliminar
                </Btn>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="animals">
          <AnimalTable
            animals={animals}
            onSelect={(id) => {
              p.onNavigate("animals");
              p.setSelected(id);
            }}
          />
        </TabsContent>
        {p.perms.canMoney && c && (
          <TabsContent value="costs">
            <div className="metric-grid">
              <Metric label="Costo acumulado" value={money(c.current, cur)} icon={<Wallet size={19} />} foot="Compra + gastos directos + prorrateo de los animales actuales" />
              <Metric label="Gastos por kg producido" value={c.perKgProduced !== null ? money(c.perKgProduced, cur, 2) : "–"} icon={<Receipt size={19} />} foot="Gastos (incluye pérdidas por muerte) / kg producidos" />
              <Metric label="Valor de mercado estimado" value={l.marketValue !== null ? money(l.marketValue, cur) : "–"} icon={<TrendingUp size={19} />} foot={l.marketPrice !== null ? `Referencia: ${money(l.marketPrice, cur, 2)} / kg` : "Sin precio de referencia para la categoría"} />
              <Metric label={closed ? "Resultado realizado" : "Margen estimado"} value={closed ? money(l.realizedResult, cur) : l.estimatedMargin !== null ? money(l.estimatedMargin, cur) : "–"} icon={<Target size={19} />} foot={closed ? `${money(l.revenue, cur)} de ingresos por ventas` : "Valor de mercado − costo acumulado"} />
            </div>
            <Panel title="Composición de los costos" subtitle={`Prorrateo de gastos globales ${p.snapshot.farm.allocationMethod === "heads" ? "por cabezas" : "por cabeza-día"}`}>
              <DataTable
                headers={["Concepto", "Criterio", "Importe"]}
                rows={[
                  ["Costo de compra", "Animales actuales del lote (incluye comisiones y flete)", money(c.purchase, cur, 2)],
                  ["Gastos directos", "Imputados al lote (histórico)", money(c.direct, cur, 2)],
                  ["Gastos del campo", "Prorrateo histórico", money(c.allocated, cur, 2)],
                  ["Parte de gastos de los animales actuales", "El costo sigue al animal", money(c.expenses, cur, 2)],
                  ["Pérdidas por muertes", "Costo acumulado de los animales muertos", money(c.deathLoss, cur, 2)],
                  [<strong key="t">Costo acumulado actual</strong>, `${money(c.perHead, cur, 2)} por cabeza · ${money(c.dailyPerHead, cur, 2)} por cabeza y día`, <strong key="c">{money(c.current, cur, 2)}</strong>],
                  ["Costo total por kg producido", "Incluye compra", c.fullPerKgProduced !== null ? money(c.fullPerKgProduced, cur, 2) : "–"],
                ]}
              />
            </Panel>
            {(l.soldHeads > 0 || closed) && (
              <Panel title="Ventas del lote">
                <DataTable
                  headers={["Ingresos netos", "Costo de lo vendido", "Resultado realizado", "Cabezas"]}
                  rows={[[money(l.revenue, cur, 2), money((l.revenue || 0) - (l.realizedResult || 0), cur, 2), <strong key="r" className={(l.realizedResult || 0) >= 0 ? "gain" : "negative"}>{money(l.realizedResult, cur, 2)}</strong>, String(l.soldHeads)]]}
                />
              </Panel>
            )}
          </TabsContent>
        )}
        <TabsContent value="history">
          <Panel title="Historial del lote">
            <div className="timeline">
              {timeline.map((r) => (
                <div key={r.id}>
                  <span className="timeline-point">
                    <CalendarDays size={17} />
                  </span>
                  <div>
                    <small>
                      {dateLabel(r.date, true)} · {r.kind}
                    </small>
                    <strong>{r.title}</strong>
                    <p>
                      {r.detail}{" "}
                      {r.record && (
                        <button className="text-link" onClick={() => p.onAction({ type: "record", record: r.record })}>
                          Ver
                        </button>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              {!timeline.length && <p className="form-note">Todavía no hay actividad en este lote.</p>}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
      <span className="muted" style={{ display: "none" }}>{lotName(null)}</span>
    </>
  );
}

// ---------- Animales ----------

function AnimalTable({ animals, onSelect }: { animals: AnimalView[]; onSelect: (id: string) => void }) {
  const [limit, setLimit] = useState(15);
  return (
    <Panel>
      <DataTable
        headers={["Caravana electrónica", "Visual", "Categoría", "Sexo", "Propietario", "Último peso", "GDP", "Estado", ""]}
        rows={animals.slice(0, limit).map((a) => [
          <button className="animal-id" key="i" onClick={() => onSelect(a.id)}>
            {a.eid}
          </button>,
          a.visual,
          catLabel(a.category),
          SEX_LABELS[a.sex as keyof typeof SEX_LABELS] || a.sex,
          a.owner ? (
            <span key="o" title={a.owner.dicose ? `DICOSE ${a.owner.dicose}` : undefined}>
              {a.owner.name}
              {a.owner.dicose ? <small className="muted"> · {a.owner.dicose}</small> : null}
            </span>
          ) : (
            "–"
          ),
          a.weight !== null ? `${fmt(a.weight, 1)} kg` : "–",
          a.gain !== null ? `${fmt(a.gain, 2)}` : "–",
          <span key="s" className="badge-row">
            <Badge tone={a.status === "activo" ? "green" : "gray"}>{ANIMAL_STATUS_LABELS[a.status] || a.status}</Badge>
            <AnimalBadges animal={a} />
          </span>,
          <button key="v" className="icon-btn" aria-label={`Ver animal ${a.visual}`} onClick={() => onSelect(a.id)}>
            <ChevronRight size={17} />
          </button>,
        ])}
      />
      {!animals.length && <Empty title="No encontramos animales" description="Revisá la caravana o modificá los filtros." />}
      <div className="table-footer">
        <span>
          Mostrando {Math.min(limit, animals.length)} de {animals.length} animales
        </span>
        {limit < animals.length && (
          <button className="text-link" onClick={() => setLimit((n) => n + 30)}>
            Cargar más
            <Plus size={14} />
          </button>
        )}
      </div>
    </Panel>
  );
}

type Timeline = { animal: Record<string, unknown>; timeline: { id: string; kind: string; date: string; title: string; detail: string }[] };

function AnimalDetail(p: ViewsProps & { animal: AnimalView }) {
  const animal = p.animal;
  const cur = currencySymbol(p.snapshot.farm.currency);
  const l = p.snapshot.lots.find((x) => x.id === animal.lot);
  const [data, setData] = useState<Timeline | null>(null);
  useEffect(() => {
    api.get<Timeline>(farmPath(p.snapshot.farm.id, `/animals/${animal.id}`)).then(setData).catch(() => setData(null));
  }, [animal.id, p.snapshot]);
  const icons: Record<string, typeof Scale> = { pesada: Scale, movimiento: ArrowRight, sanidad: HeartPulse, lote: Layers, reproduccion: Baby, nota: Pencil };
  return (
    <>
      <button className="back-link" onClick={() => p.setSelected(null)}>
        <ArrowLeft size={15} />
        Volver a animales
      </button>
      <div className="detail-heading">
        <div>
          <span className="eyebrow">FICHA INDIVIDUAL</span>
          <h2>
            Caravana {animal.visual}
            <Badge tone={animal.status === "activo" ? "green" : "gray"}>{ANIMAL_STATUS_LABELS[animal.status] || animal.status}</Badge>
          </h2>
          <p className="animal-id">{animal.eid}</p>
        </div>
        <div className="detail-actions">
          {p.perms.canWrite && (
            <Btn onClick={() => p.onAction({ type: "editAnimal", animal: animal.id })}>
              <Pencil size={15} />
              Editar
            </Btn>
          )}
          {animal.status === "activo" && p.perms.canWrite && (
            <Btn variant="primary" onClick={() => p.onAction({ type: "manual", animal: animal.id, lot: animal.lot || undefined })}>
              <Scale size={16} />
              Registrar peso
            </Btn>
          )}
        </div>
      </div>
      <div className="animal-summary">
        <Panel title="Datos del animal">
          <dl className="detail-list">
            <div>
              <dt>Categoría / sexo</dt>
              <dd>
                {catLabel(animal.category)} · {SEX_LABELS[animal.sex as keyof typeof SEX_LABELS] || animal.sex}
                {animal.breed ? ` · ${animal.breed}` : ""}
              </dd>
            </div>
            <div>
              <dt>Lote actual</dt>
              <dd>{l?.name || "Sin lote"}{animal.daysInLot !== null ? ` · ${animal.daysInLot} días` : ""}</dd>
            </div>
            <div>
              <dt>Último peso</dt>
              <dd>{animal.weight !== null ? `${fmt(animal.weight, 1)} kg · ${dateLabel(animal.lastDate, true)}` : "Sin pesadas"}</dd>
            </div>
            <div>
              <dt>GDP</dt>
              <dd>{animal.gain !== null ? `${fmt(animal.gain, 2)} kg/día` : "–"}</dd>
            </div>
            <div>
              <dt>Origen</dt>
              <dd>
                {ORIGIN_LABELS[animal.origin] || animal.origin}
                {animal.purchaseDate ? ` · ${dateLabel(animal.purchaseDate, true)}` : ""}
                {animal.birthDate ? ` · nac. ${dateLabel(animal.birthDate, true)}` : ""}
              </dd>
            </div>
            {p.perms.canMoney && (
              <div>
                <dt>Costo acumulado</dt>
                <dd>{money(animal.cost, cur, 2)}{animal.purchaseCost !== null ? ` (compra ${money(animal.purchaseCost, cur, 2)})` : ""}</dd>
              </div>
            )}
            <div>
              <dt>Propietario</dt>
              <dd>
                {animal.owner ? (
                  <>
                    {animal.owner.name}
                    {animal.owner.dicose ? ` · DICOSE ${animal.owner.dicose}` : ""}
                  </>
                ) : (
                  "Sin propietario asignado"
                )}
              </dd>
            </div>
            <div>
              <dt>Situación bancaria</dt>
              <dd>
                {animal.pledge ? (
                  <Badge tone="amber">
                    <Landmark size={13} /> A nombre de {animal.pledge.bank}
                    {animal.pledge.ref ? ` · ${animal.pledge.ref}` : ""}
                    {animal.pledge.since ? ` · desde ${dateLabel(animal.pledge.since, true)}` : ""}
                  </Badge>
                ) : (
                  <Badge>Sin prenda</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt>Sanidad</dt>
              <dd>
                {animal.withdrawalUntil ? <Badge tone="amber">Retiro hasta {dateLabel(animal.withdrawalUntil, true)}</Badge> : <Badge>Sin retiros vigentes</Badge>}
                {animal.diseases.map((d) => (
                  <Badge key={d.product} tone="red">
                    <Bug size={13} /> {d.product} · {dateLabel(d.date, true)}
                  </Badge>
                ))}
              </dd>
            </div>
            {animal.sex !== "macho" && (
              <div>
                <dt>Reproducción</dt>
                <dd>
                  {animal.repro?.pregnant ? (
                    <>
                      <Badge tone="green">
                        <Baby size={13} /> Preñada · {fmt(animal.repro.months ?? 0, 1)} meses
                      </Badge>
                      <small className="block">
                        Parto estimado <strong>{dateLabel(animal.repro.expectedCalving, true)}</strong>
                        {animal.repro.daysToCalving !== null ? ` (${animal.repro.daysToCalving >= 0 ? `en ${animal.repro.daysToCalving} días` : `hace ${-animal.repro.daysToCalving} días`})` : ""}
                      </small>
                      <small className="block muted">
                        {animal.repro.checkedAt ? `Diagnóstico ${dateLabel(animal.repro.checkedAt, true)}` : ""}
                        {animal.repro.bullEid ? ` · toro ${animal.repro.bullEid}` : ""}
                      </small>
                    </>
                  ) : animal.repro?.inService ? (
                    <>
                      <Badge tone="blue">En entore desde {dateLabel(animal.repro.serviceSince, true)}</Badge>
                      <small className="block muted">{animal.repro.bullEid ? `Toro ${animal.repro.bullEid}` : "Sin toro indicado"}</small>
                    </>
                  ) : animal.repro?.lastEventType === "vacia" ? (
                    <Badge tone="gray">Vacía · diagnóstico {dateLabel(animal.repro.lastEventDate, true)}</Badge>
                  ) : (
                    "Sin eventos reproductivos"
                  )}
                  {animal.repro?.lastCalving ? <small className="block muted">Último parto {dateLabel(animal.repro.lastCalving, true)}</small> : null}
                </dd>
              </div>
            )}
            {animal.notes && (
              <div>
                <dt>Notas</dt>
                <dd>{animal.notes}</dd>
              </div>
            )}
          </dl>
          {animal.status === "activo" && p.perms.canWrite && (
            <div className="panel-padding detail-actions">
              <Btn onClick={() => p.onAction({ type: "health", lot: animal.lot || undefined, animal: animal.id })}>Registrar tratamiento</Btn>
              <Btn onClick={() => p.onAction({ type: "health", lot: animal.lot || undefined, animal: animal.id, record: "enfermedad" })}>
                <Bug size={15} />
                Enfermedad detectada
              </Btn>
              {animal.sex !== "macho" && (
                <Btn onClick={() => p.onAction({ type: "repro", animal: animal.id })}>
                  <Baby size={15} />
                  Evento reproductivo
                </Btn>
              )}
            </div>
          )}
        </Panel>
        <Panel title="La historia de este animal" subtitle="Pesadas, movimientos, sanidad y lotes">
          <div className="timeline">
            {(data?.timeline || []).map((t) => {
              const Icon = icons[t.kind] || CalendarDays;
              return (
                <div key={t.id}>
                  <span className="timeline-point">
                    <Icon size={18} />
                  </span>
                  <div>
                    <small>
                      {dateLabel(t.date, true)} · {t.kind}
                    </small>
                    <strong>{t.title}</strong>
                    <p>{t.detail}</p>
                  </div>
                </div>
              );
            })}
            {data && !data.timeline.length && <p className="form-note">Todavía no hay registros para este animal.</p>}
            {!data && <p className="form-note">Cargando la historia...</p>}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Animals(p: ViewsProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [lot, setLot] = useState("all");
  const [status, setStatus] = useState("activo");
  const [owner, setOwner] = useState("all");
  const [situation, setSituation] = useState("all");
  const animal = p.snapshot.animals.find((a) => a.id === p.selected);
  if (animal) return <AnimalDetail {...p} animal={animal} />;
  const matchesSituation = (a: AnimalView) =>
    situation === "all" ||
    (situation === "prenada" && !!a.repro?.pregnant) ||
    (situation === "entore" && !!a.repro?.inService) ||
    (situation === "vacia" && a.repro?.lastEventType === "vacia") ||
    (situation === "prendado" && !!a.pledge) ||
    (situation === "enfermo" && a.diseases.length > 0) ||
    (situation === "retiro" && !!a.withdrawalUntil);
  const list = p.snapshot.animals.filter(
    (a) =>
      (a.eid.includes(query) || a.visual.toLowerCase().includes(query.toLowerCase())) &&
      (category === ALL || a.category === category) &&
      (lot === "all" || a.lot === lot || (lot === "none" && !a.lot)) &&
      (status === "todos" || a.status === status) &&
      (owner === "all" || a.owner?.id === owner || (owner === "none" && !a.owner)) &&
      matchesSituation(a),
  );
  const t = p.snapshot.totals;
  return (
    <>
      <div className="section-toolbar">
        <div className="filters">
          <FilterSearch value={query} onChange={setQuery} placeholder="Caravana electrónica o visual..." />
          <Pick label="Categoría" value={category} onChange={setCategory} options={categoryFilterOptions} />
          <Pick label="Lote" value={lot} onChange={setLot} options={[{ value: "all", label: "Todos los lotes" }, { value: "none", label: "Sin lote" }, ...p.snapshot.lots.map((l) => ({ value: l.id, label: l.name }))]} />
          <Pick label="Estado" value={status} onChange={setStatus} options={[{ value: "activo", label: "Activos" }, { value: "vendido", label: "Vendidos" }, { value: "muerto", label: "Muertos" }, { value: "transferido", label: "Transferidos" }, { value: "todos", label: "Todos" }]} />
          <Pick label="Propietario" value={owner} onChange={setOwner} options={[{ value: "all", label: "Todos los propietarios" }, { value: "none", label: "Sin propietario" }, ...p.snapshot.owners.map((o) => ({ value: o.id, label: o.dicose ? `${o.name} · ${o.dicose}` : o.name }))]} />
          <Pick
            label="Situación"
            value={situation}
            onChange={setSituation}
            options={[
              { value: "all", label: "Cualquier situación" },
              { value: "prenada", label: `Preñadas (${t.pregnant})` },
              { value: "entore", label: `En entore (${t.inService})` },
              { value: "vacia", label: "Vacías" },
              { value: "prendado", label: `A nombre del banco (${t.pledged})` },
              { value: "enfermo", label: `Con enfermedad detectada (${t.sick})` },
              { value: "retiro", label: "Con retiro vigente" },
            ]}
          />
        </div>
        <div className="detail-actions">
          <Badge tone="gray">{p.snapshot.animals.filter((a) => a.status === "activo").length} animales activos</Badge>
          <Btn onClick={() => downloadFile(farmPath(p.snapshot.farm.id, "/export/animales"), "animales.xlsx")}>
            <Download size={15} />
            Excel
          </Btn>
          {p.perms.canWrite && (
            <Btn variant="primary" onClick={() => p.onAction({ type: "animal" })}>
              <Plus size={16} />
              Alta de animal
            </Btn>
          )}
        </div>
      </div>
      <AnimalTable animals={list} onSelect={p.setSelected} />
    </>
  );
}

// ---------- Registros: pesadas, gastos, sanidad, movimientos ----------

type RecordRow = { id: string; date: string; name: string; detail: string; category: string; tone: string; lot: string; amountLabel: string; record: string; amount: number };

function Records(p: ViewsProps & { kind: "expenses" | "sessions" | "health" | "movements" }) {
  const cur = currencySymbol(p.snapshot.farm.currency);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Por categoría");
  const [category, setCategory] = useState("Todas");
  const [lot, setLot] = useState("all");
  const [period, setPeriod] = useState("Todos los períodos");
  const s = p.snapshot;
  const lotName = (id: string | null) => s.lots.find((l) => l.id === id)?.name || (id === "multi" ? "Varios lotes" : "Campo general");
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of [...s.sessions, ...s.expenses, ...s.health, ...s.movements]) set.add(r.date.slice(0, 7));
    return [...set].sort().reverse();
  }, [s]);
  const monthLabel = (m: string) => new Date(m + "-15T12:00:00").toLocaleDateString("es-UY", { month: "long", year: "numeric" });
  const entries: RecordRow[] = useMemo(() => {
    if (p.kind === "sessions")
      return s.sessions.map((r) => ({ id: r.id, date: r.date, name: r.name, detail: `${r.avgWeight !== null ? fmt(r.avgWeight, 1) + " kg promedio · " : ""}${r.lotIds.map(lotName).join(", ") || "sin lote"}`, category: r.origin === "importada" ? "Importada" : r.origin === "promedio" ? "Promedio" : "Manual", tone: "green", lot: r.lotIds[0] || "global", amountLabel: String(r.count), record: `sessions:${r.id}`, amount: r.count }));
    if (p.kind === "expenses")
      return s.expenses.map((r) => ({ id: r.id, date: r.date, name: r.description, detail: [r.supplier, r.quantity ? `${fmt(r.quantity, 2)} ${r.unit || ""}` : null, r.subcategory ? PASTURE_SUBTYPE_LABELS[r.subcategory] : null].filter(Boolean).join(" · "), category: EXPENSE_CATEGORY_LABELS[r.category as keyof typeof EXPENSE_CATEGORY_LABELS] || r.category, tone: "green", lot: r.lot, amountLabel: r.total !== null ? money(r.total, cur, 2) : "Restringido", record: `expenses:${r.id}`, amount: r.total || 0 }));
    if (p.kind === "health")
      return s.health.map((r) => ({ id: r.id, date: r.date, name: `${HEALTH_TYPE_LABELS[r.type as keyof typeof HEALTH_TYPE_LABELS] || r.type} · ${r.product}`, detail: `${r.dose || ""}${r.dose ? " · " : ""}${r.animalCount} animales`, category: r.withdrawalActive ? "Retiro vigente" : r.date > s.today ? "Programado" : "Aplicado", tone: r.withdrawalActive ? "amber" : r.date > s.today ? "blue" : "green", lot: r.lotId || "global", amountLabel: r.withdrawalDays ? `${r.withdrawalDays} días` : "Sin retiro", record: `health:${r.id}`, amount: r.withdrawalDays }));
    return s.movements.map((r) => ({ id: r.id, date: r.date, name: r.typeLabel + (r.counterparty ? ` · ${r.counterparty}` : ""), detail: `${r.headCount} animales${r.totalWeight ? ` · ${fmt(r.totalWeight)} kg` : ""}${r.cause ? ` · ${r.cause}` : ""}`, category: r.typeLabel, tone: r.type === "venta" ? "green" : r.type === "compra" ? "blue" : r.type === "muerte" ? "amber" : "gray", lot: r.lot, amountLabel: r.netAmount !== null ? money(r.netAmount, cur, 2) : p.perms.canMoney ? "–" : "Restringido", record: `movements:${r.id}`, amount: r.netAmount || 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.kind, s, cur, p.perms.canMoney]);
  const filtered = entries.filter(
    (e) =>
      (e.name + " " + e.detail).toLowerCase().includes(query.toLowerCase()) &&
      (category === "Todas" || e.category === category) &&
      (lot === "all" || e.lot === lot) &&
      (period === "Todos los períodos" || e.date.startsWith(period)),
  );
  const sum = filtered.reduce((acc, e) => acc + e.amount, 0);
  const names = { expenses: ["Nuevo gasto", "expense"], sessions: ["Importar pesada", "import"], health: ["Registrar evento", "health"], movements: ["Registrar compra", "purchase"] };
  const exportKind = { expenses: "gastos", sessions: "pesadas", health: null, movements: "movimientos" }[p.kind];
  const reminders = s.reminders;
  return (
    <>
      <div className="section-toolbar">
        <div className="filters">
          <FilterSearch value={query} onChange={setQuery} placeholder="Buscar un registro..." />
          <Pick label="Tipo" value={category} onChange={setCategory} options={["Todas", ...Array.from(new Set(entries.map((e) => e.category)))]} />
          <Pick label="Lote" value={lot} onChange={setLot} options={[{ value: "all", label: "Todos los lotes" }, { value: "global", label: "Campo general" }, ...s.lots.map((l) => ({ value: l.id, label: l.name }))]} />
          <Pick label="Período de registros" value={period} onChange={setPeriod} options={[{ value: "Todos los períodos", label: "Todos los períodos" }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
        </div>
        <div className="detail-actions">
          {exportKind && (p.kind !== "expenses" || p.perms.canMoney) && (
            <Btn onClick={() => downloadFile(farmPath(s.farm.id, `/export/${exportKind}`), `${exportKind}.xlsx`)}>
              <Download size={15} />
              Excel
            </Btn>
          )}
          {p.kind === "sessions" && p.perms.canWrite && (
            <Btn onClick={() => p.onAction({ type: "manual" })}>
              <Plus size={16} />
              Carga manual
            </Btn>
          )}
          {p.kind === "movements" && p.perms.canMoney && p.perms.canWrite && <Btn onClick={() => p.onAction({ type: "sale" })}>Registrar venta</Btn>}
          {p.kind === "movements" && p.perms.canWrite && <Btn onClick={() => p.onAction({ type: "transfer" })}>Mover animales</Btn>}
          {p.kind === "health" && p.perms.canWrite && <Btn onClick={() => p.onAction({ type: "reminder" })}>Recordatorio</Btn>}
          {p.perms.canWrite && (p.kind !== "movements" || p.perms.canMoney) && (
            <Btn variant="primary" onClick={() => p.onAction({ type: names[p.kind][1] })}>
              <Plus size={16} />
              {names[p.kind][0]}
            </Btn>
          )}
        </div>
      </div>
      {p.kind === "expenses" && p.perms.canMoney && (
        <div className="expense-summary">
          <Panel>
            <small>GASTOS EN LA VISTA</small>
            <strong>{money(sum, cur)}</strong>
            <p>
              {filtered.length} registros · moneda {s.farm.currency}
            </p>
          </Panel>
          <Panel>
            <div className="summary-group">
              <small>DISTRIBUCIÓN DE GASTOS</small>
              <Pick label="Agrupar gastos" value={group} onChange={setGroup} options={["Por categoría", "Por lote", "Por proveedor"]} />
            </div>
            <div className="expense-bars">
              {Array.from(new Set(filtered.map((e) => (group === "Por categoría" ? e.category : group === "Por lote" ? e.lot : s.expenses.find((x) => x.id === e.id)?.supplier || "Sin proveedor")))).map((c, i) => {
                const total = filtered.filter((e) => (group === "Por categoría" ? e.category : group === "Por lote" ? e.lot : s.expenses.find((x) => x.id === e.id)?.supplier || "Sin proveedor") === c).reduce((acc, e) => acc + e.amount, 0);
                return (
                  <div key={c}>
                    <span>{group === "Por lote" ? lotName(c) : c}</span>
                    <div>
                      <i style={{ width: `${(total / Math.max(sum, 1)) * 100}%`, background: ["#527654", "#9eaf70", "#cfb986", "#7e9b91", "#baa48c"][i % 5] }} />
                    </div>
                    <strong>{money(total, cur)}</strong>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      )}
      {p.kind === "health" && (
        <>
          <div className="notice">
            <ShieldCheck size={20} />
            <span>
              <strong>{s.health.filter((e) => e.withdrawalActive).length} evento(s) con retiro vigente.</strong> Revisá las fechas de habilitación antes de registrar una venta. Política del campo: {s.farm.withdrawalPolicy === "block" ? "bloquear la venta" : "advertir"}.
            </span>
          </div>
          {reminders.length > 0 && (
            <Panel title="Recordatorios" subtitle="Próximas dosis y vencimientos definidos por vos">
              <DataTable
                headers={["Fecha", "Recordatorio", "Lote", ""]}
                rows={reminders.map((r) => [
                  <span key="d" className={r.dueDate < s.today ? "warning-text" : ""}>
                    {dateLabel(r.dueDate, true)}
                  </span>,
                  <div key="n" className="record-name">
                    <strong>{r.title}</strong>
                    <small>{r.notes}</small>
                  </div>,
                  r.lotName || "Campo general",
                  p.perms.canWrite ? (
                    <button key="b" className="text-link" onClick={() => api.patch(farmPath(s.farm.id, `/health/reminders/${r.id}`), { done: true }).then(() => p.onRefresh("Recordatorio completado")).catch((e) => toast.error(e.message))}>
                      <Check size={14} /> Hecho
                    </button>
                  ) : (
                    ""
                  ),
                ])}
              />
            </Panel>
          )}
        </>
      )}
      <Panel title={p.kind === "sessions" ? "Sesiones de pesada" : p.kind === "health" ? "Plan sanitario" : p.kind === "expenses" ? "Todos los gastos" : "Historial de operaciones"} subtitle={`${filtered.length} registros en ${s.farm.name}`}>
        <DataTable
          headers={["Fecha", p.kind === "expenses" ? "Concepto" : "Registro", "Lote / imputación", "Estado / tipo", p.kind === "sessions" ? "Animales" : p.kind === "health" ? "Retiro" : "Importe", ""]}
          rows={filtered.map((r) => [
            dateLabel(r.date, true),
            <div key="n" className="record-name">
              <strong>{r.name}</strong>
              <small>{r.detail}</small>
            </div>,
            lotName(r.lot),
            <Badge key="c" tone={r.tone}>
              {r.category}
            </Badge>,
            r.amountLabel,
            <button key="b" className="icon-btn" aria-label={`Ver ${r.name}`} onClick={() => p.onAction({ type: "record", record: r.record })}>
              <ChevronRight size={16} />
            </button>,
          ])}
        />
        {!filtered.length && <Empty title="Todavía no hay registros" description="Agregá el primer registro o probá con otros filtros." />}
        <div className="table-footer">
          <span>Demo · registros guardados en este navegador</span>
        </div>
      </Panel>
    </>
  );
}

// ---------- Análisis ----------

type SaleSim = {
  curve: { days: number; date: string; weight: number; revenue: number; cost: number; margin: number; marginPerHead: number }[];
  best: { days: number; date: string; weight: number; revenue: number; cost: number; margin: number; marginPerHead: number };
  today: { days: number; date: string; weight: number; revenue: number; cost: number; margin: number };
  sensitivity: { priceMinus: { price: number; best: { days: number; date: string; margin: number } }; pricePlus: { price: number; best: { days: number; date: string; margin: number } } };
  assumptions: Record<string, string | number>;
};
type PurchaseSim = Record<string, string | number | null> & { assumptions: Record<string, string | number> };
type Compare = { lotId: string; name: string; category: string; status: string; headCount: number; avgWeight: number | null; gdp: number | null; kgProduced: number | null; costPerKgProduced: number | null; costPerHead: number | null; currentCost: number | null; marketValue: number | null; projectedMargin: number | null; realizedResult: number | null; pricePerKg: number | null; marginPerKg: number | null };

type PriceRow = { id: string; date: string; category: string; pricePerKg: number; source: string; provider: string | null; basis: string };
const BASIS_LABELS: Record<string, string> = { en_pie: "en pie", cuarta_balanza: "4ta balanza" };

function Analysis(p: ViewsProps) {
  const s = p.snapshot;
  const cur = currencySymbol(s.farm.currency);
  const activeLots = s.lots.filter((l) => l.status === "activo" && l.count > 0);
  const [mode, setMode] = useState("sale");
  const [lotId, setLotId] = useState(activeLots[0]?.id || "");
  const [days, setDays] = useState(60);
  const [horizon, setHorizon] = useState(180);
  const [price, setPrice] = useState("");
  const [gdp, setGdp] = useState("");
  const [daily, setDaily] = useState("");
  const [commission, setCommission] = useState("");
  const [sim, setSim] = useState<SaleSim | null>(null);
  const [simError, setSimError] = useState("");
  const [buyCategory, setBuyCategory] = useState("ternero");
  const [purchase, setPurchase] = useState("2.60");
  const [buyMode, setBuyMode] = useState<"kg" | "cabeza">("kg");
  const [buyWeight, setBuyWeight] = useState("200");
  const [expectedGain, setExpectedGain] = useState("");
  const [buyDaily, setBuyDaily] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [targetWeight, setTargetWeight] = useState("400");
  const [heads, setHeads] = useState("50");
  const [buy, setBuy] = useState<PurchaseSim | null>(null);
  const [buyError, setBuyError] = useState("");
  const [compare, setCompare] = useState<Compare[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [marketCategory, setMarketCategory] = useState("novillo");

  useEffect(() => {
    if (!p.perms.canMoney || !lotId) return;
    const q = new URLSearchParams({ horizon: String(horizon), step: "5" });
    if (price) q.set("price", price);
    if (gdp) q.set("gdp", gdp);
    if (daily) q.set("dailyCost", daily);
    if (commission) q.set("commission", commission);
    const t = setTimeout(() => {
      api
        .get<SaleSim>(farmPath(s.farm.id, `/lots/${lotId}/sale-simulation?${q}`))
        .then((r) => {
          setSim(r);
          setSimError("");
        })
        .catch((e: ApiError) => {
          setSim(null);
          setSimError(e.message);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [lotId, horizon, price, gdp, daily, commission, s.farm.id, p.perms.canMoney]);

  useEffect(() => {
    if (!p.perms.canMoney || mode !== "purchase") return;
    const t = setTimeout(() => {
      api
        .post<PurchaseSim>(farmPath(s.farm.id, "/analytics/purchase-simulation"), {
          category: buyCategory,
          entryWeight: buyWeight,
          purchasePrice: purchase,
          purchasePriceMode: buyMode,
          expectedGdp: expectedGain || null,
          dailyCostPerHead: buyDaily || null,
          salePricePerKg: salePrice || null,
          targetWeight: targetWeight || null,
          headCount: Number(heads) || 1,
        })
        .then((r) => {
          setBuy(r);
          setBuyError("");
        })
        .catch((e: ApiError) => {
          setBuy(null);
          setBuyError(e.message);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [mode, buyCategory, buyWeight, purchase, buyMode, expectedGain, buyDaily, salePrice, targetWeight, heads, s.farm.id, p.perms.canMoney]);

  useEffect(() => {
    if (!p.perms.canMoney) return;
    if (mode === "compare") api.get<Compare[]>(farmPath(s.farm.id, "/analytics/compare")).then(setCompare).catch(() => setCompare([]));
    if (mode === "market") api.get<PriceRow[]>(farmPath(s.farm.id, "/prices")).then(setPrices).catch(() => setPrices([]));
  }, [mode, s.farm.id, p.perms.canMoney, s]);

  if (!p.perms.canMoney) return <Panel><Empty title="Análisis económico restringido" description="Tu rol en este campo no incluye el acceso a montos ni análisis económico." /></Panel>;

  const point = sim?.curve.reduce((best, pt) => (Math.abs(pt.days - days) < Math.abs(best.days - days) ? pt : best), sim.curve[0]);
  const marketLot = s.lots.find((l) => l.status === "activo" && l.category === marketCategory);
  const categoryPrices = prices.filter((x) => x.category === marketCategory);
  const marketPoints = [...new Set(categoryPrices.map((x) => x.date))].sort().map((date) => {
    const at = (basis: string) => categoryPrices.find((x) => x.date === date && x.basis === basis)?.pricePerKg ?? null;
    return { date, market: at("en_pie"), carcass: at("cuarta_balanza"), cost: marketLot?.costs?.perKgLive ?? null };
  });
  const acgLatest = prices.filter((x) => x.provider === "ACG").sort((a, b) => b.date.localeCompare(a.date))[0];

  return (
    <>
      <div className="notice subtle">
        <TrendingUp size={19} />
        <span>Las simulaciones usan la GDP de tendencia, el costo diario reciente y el último precio de referencia del campo. Cada resultado muestra los supuestos que usó; ajustalos para explorar escenarios.</span>
      </div>
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList className="page-tabs" variant="line">
          <TabsTrigger value="sale">Simulador de venta</TabsTrigger>
          <TabsTrigger value="purchase">Simulador de compra</TabsTrigger>
          <TabsTrigger value="compare">Comparar lotes</TabsTrigger>
          <TabsTrigger value="market">Mercado y costos</TabsTrigger>
        </TabsList>
        {mode === "market" ? (
          <Panel
            title="El precio y tu punto de equilibrio"
            subtitle={`Precio de referencia vs. costo acumulado por kg en pie (precio de equilibrio) · ${cur}${acgLatest ? ` · ACG semana al ${dateLabel(acgLatest.date, true)}` : ""}`}
            action={<Pick label="Categoría" value={marketCategory} onChange={setMarketCategory} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />}
          >
            <MarketChart points={marketPoints} currency={cur} />
            <div className="chart-footer">
              <span>
                <i />
                Precio en pie ({categoryPrices.filter((x) => x.basis === "en_pie").length} cotizaciones)
              </span>
              {categoryPrices.some((x) => x.basis === "cuarta_balanza") && <span>Precio 4ta balanza · ganado gordo ACG ({categoryPrices.filter((x) => x.basis === "cuarta_balanza").length} cotizaciones)</span>}
              <span>Costo por kg en pie: {marketLot ? `${marketLot.name} · ${marketLot.costs?.perKgLive !== null && marketLot.costs?.perKgLive !== undefined ? money(marketLot.costs.perKgLive, cur, 2) : "sin datos"}` : "sin lote activo de la categoría"}</span>
            </div>
            <div className="panel-padding muted">
              Los promedios semanales de ACG (acg.com.uy) se cargan solos los lunes a la noche: reposición (terneros, terneras, vaca de invernada) en pie y ganado gordo (novillo, vaca, vaquillona) en cuarta balanza. Solo los precios en pie se usan para valuar lotes y en los simuladores.
            </div>
          </Panel>
        ) : mode === "compare" ? (
          <Panel title="Cada lote, en perspectiva" action={<Btn onClick={() => downloadFile(farmPath(s.farm.id, "/export/lotes"), "lotes.xlsx")}><Download size={15} />Excel</Btn>}>
            <DataTable
              headers={["Lote", "Estado", "Cabezas", "GDP (kg/día)", "Peso actual", "Gastos / kg producido", "Costo / animal", "Valor estimado", "Margen proyectado", "Resultado realizado"]}
              rows={compare.map((l) => [
                l.name,
                <Badge key="s" tone={l.status === "activo" ? "green" : "gray"}>{l.status === "activo" ? "Activo" : "Cerrado"}</Badge>,
                String(l.headCount),
                l.gdp !== null ? fmt(l.gdp, 2) : "–",
                l.avgWeight !== null ? `${fmt(l.avgWeight)} kg` : "–",
                l.costPerKgProduced !== null ? money(l.costPerKgProduced, cur, 2) : "–",
                l.costPerHead !== null ? money(l.costPerHead, cur) : "–",
                l.marketValue !== null ? money(l.marketValue, cur) : "–",
                l.projectedMargin !== null ? <strong key="m" className={l.projectedMargin >= 0 ? "gain" : "negative"}>{money(l.projectedMargin, cur)}</strong> : "–",
                l.realizedResult !== null ? <strong key="r" className={l.realizedResult >= 0 ? "gain" : "negative"}>{money(l.realizedResult, cur)}</strong> : "–",
              ])}
            />
            <div className="panel-padding muted">Margen proyectado = valor de mercado (último precio de referencia de la categoría) − costo acumulado; no incluye comercialización. Resultado realizado = ventas netas − costo de lo vendido.</div>
          </Panel>
        ) : mode === "purchase" ? (
          <div className="simulator-grid">
            <Panel title="Explorá tu próxima compra" subtitle="Ajustá las variables de la simulación">
              <div className="form-grid panel-padding">
                <Field label="Categoría de compra">
                  <Pick label="Categoría de compra" value={buyCategory} onChange={setBuyCategory} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
                </Field>
                <Field label="Cantidad de animales">
                  <input type="number" min="1" value={heads} onChange={(e) => setHeads(e.target.value)} />
                </Field>
                <Field label={`Precio de compra (${cur})`}>
                  <input type="number" min="0" step="0.01" value={purchase} onChange={(e) => setPurchase(e.target.value)} />
                </Field>
                <Field label="Modalidad">
                  <Pick label="Modalidad" value={buyMode} onChange={(v) => setBuyMode(v as "kg" | "cabeza")} options={[{ value: "kg", label: "Por kg" }, { value: "cabeza", label: "Por cabeza" }]} />
                </Field>
                <Field label="Peso de ingreso (kg)">
                  <input type="number" min="1" value={buyWeight} onChange={(e) => setBuyWeight(e.target.value)} />
                </Field>
                <Field label="Peso de venta objetivo (kg)">
                  <input type="number" min="1" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
                </Field>
                <Field label="GDP esperada (kg/día)">
                  <input type="number" min="0" step="0.01" value={expectedGain} onChange={(e) => setExpectedGain(e.target.value)} placeholder={buy ? String(buy.assumptions.expectedGdp) : "promedio del campo"} />
                </Field>
                <Field label={`Costo diario (${cur}/animal)`}>
                  <input type="number" min="0" step="0.01" value={buyDaily} onChange={(e) => setBuyDaily(e.target.value)} placeholder={buy ? String(buy.assumptions.dailyCostPerHead) : "promedio del campo"} />
                </Field>
                <Field label={`Precio de venta esperado (${cur}/kg)`}>
                  <input type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder={buy ? String(buy.assumptions.salePricePerKg) : "referencia"} />
                </Field>
              </div>
            </Panel>
            <Panel title="Tu escenario" className="scenario">
              {buyError && <p className="form-error">{buyError}</p>}
              {buy && (
                <>
                  <div className="scenario-result">
                    <small>MARGEN ESTIMADO POR ANIMAL</small>
                    <strong className={Number(buy.marginPerHead) < 0 ? "negative" : ""}>{money(Number(buy.marginPerHead), cur)}</strong>
                    <Badge tone={Number(buy.marginPerHead) >= 0 ? "green" : "red"}>{Number(buy.marginPerHead) >= 0 ? "Margen positivo" : "Margen negativo"}</Badge>
                  </div>
                  <dl className="detail-list">
                    <div>
                      <dt>Costo de compra</dt>
                      <dd>{money(Number(buy.purchaseCostPerHead), cur)} por cabeza</dd>
                    </div>
                    <div>
                      <dt>Fecha sugerida de venta</dt>
                      <dd>
                        {dateLabel(String(buy.suggestedSaleDate), true)} · {buy.suggestedSaleDays} días · {fmt(Number(buy.saleWeight))} kg
                      </dd>
                    </div>
                    <div>
                      <dt>Ingreso por cabeza</dt>
                      <dd>{money(Number(buy.revenuePerHead), cur)}</dd>
                    </div>
                    <div>
                      <dt>Costo de alimentación y mantenimiento</dt>
                      <dd>{money(Number(buy.feedingCostPerHead), cur)}</dd>
                    </div>
                    <div>
                      <dt>Margen por kg producido</dt>
                      <dd>{buy.marginPerKgProduced !== null ? money(Number(buy.marginPerKgProduced), cur, 2) : "–"}</dd>
                    </div>
                    <div>
                      <dt>Punto de equilibrio</dt>
                      <dd>
                        Precio de venta ≥ {money(Number(buy.breakevenSalePricePerKg), cur, 2)}/kg
                        {buy.breakevenDays !== null ? ` · margen ≥ 0 desde el día ${buy.breakevenDays}` : " · no se alcanza en el horizonte"}
                      </dd>
                    </div>
                    <div>
                      <dt>Margen total ({buy.headCount} animales)</dt>
                      <dd>{money(Number(buy.marginTotal), cur)}</dd>
                    </div>
                  </dl>
                  <div className="scenario-note">
                    Supuestos: GDP {buy.assumptions.expectedGdp} kg/día ({buy.assumptions.gdpSource}); costo diario {buy.assumptions.dailyCostPerHead} ({buy.assumptions.dailyCostSource}); precio de venta {buy.assumptions.salePricePerKg} ({buy.assumptions.salePriceSource}); objetivo {buy.assumptions.targetWeight} kg ({buy.assumptions.targetSource}).
                  </div>
                </>
              )}
            </Panel>
          </div>
        ) : (
          <>
            <div className="simulator-grid">
              <Panel title="¿Vender hoy o esperar?" subtitle="Ajustá las variables de la simulación">
                <div className="form-grid panel-padding">
                  <Field label="Lote a analizar">
                    <Pick label="Lote a analizar" value={lotId} onChange={setLotId} options={activeLots.map((l) => ({ value: l.id, label: l.name }))} />
                  </Field>
                  <Field label="Horizonte (días)">
                    <Pick label="Horizonte" value={String(horizon)} onChange={(v) => setHorizon(Number(v))} options={["90", "180", "270", "365"]} />
                  </Field>
                  <Field label={`Precio de venta (${cur}/kg)`}>
                    <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={sim ? String(sim.assumptions.pricePerKg) : "referencia"} />
                  </Field>
                  <Field label="GDP (kg/día)">
                    <input type="number" min="0" step="0.01" value={gdp} onChange={(e) => setGdp(e.target.value)} placeholder={sim ? String(sim.assumptions.gdpPerDay) : "tendencia"} />
                  </Field>
                  <Field label={`Costo diario (${cur}/animal)`}>
                    <input type="number" min="0" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder={sim ? String(sim.assumptions.dailyCostPerHead) : "reciente"} />
                  </Field>
                  <Field label="Comisión de venta (%)">
                    <input type="number" min="0" step="0.1" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" />
                  </Field>
                  <div className="slider-field">
                    <div>
                      <label>Fecha de venta</label>
                      <strong>{point ? `${point.days} días · ${dateLabel(point.date)}` : `${days} días`}</strong>
                    </div>
                    <Slider aria-label="Días hasta la venta" min={0} max={horizon} step={5} value={[days]} onValueChange={([v]) => setDays(v)} />
                    <div>
                      <small>Vender hoy</small>
                      <small>{horizon} días</small>
                    </div>
                  </div>
                </div>
              </Panel>
              <Panel title="Tu escenario" className="scenario">
                {simError && <p className="form-error">{simError}</p>}
                {sim && point && (
                  <>
                    <div className="scenario-result">
                      <small>MARGEN ESTIMADO A LOS {point.days} DÍAS</small>
                      <strong className={point.margin < 0 ? "negative" : ""}>{money(point.margin, cur)}</strong>
                      <Badge tone={point.margin >= sim.today.margin ? "green" : "amber"}>
                        {point.margin >= sim.today.margin ? `+${money(point.margin - sim.today.margin, cur)} vs. vender hoy` : `${money(point.margin - sim.today.margin, cur)} vs. vender hoy`}
                      </Badge>
                    </div>
                    <dl className="detail-list">
                      <div>
                        <dt>Peso proyectado</dt>
                        <dd>{fmt(point.weight, 1)} kg / animal</dd>
                      </div>
                      <div>
                        <dt>Valor de venta</dt>
                        <dd>{money(point.revenue, cur)}</dd>
                      </div>
                      <div>
                        <dt>Costo acumulado proyectado</dt>
                        <dd>{money(point.cost, cur)}</dd>
                      </div>
                      <div>
                        <dt>Mejor momento</dt>
                        <dd>
                          {sim.best.days === 0 ? "Vender hoy" : `${dateLabel(sim.best.date, true)} (${sim.best.days} días)`} · {money(sim.best.margin, cur)}
                        </dd>
                      </div>
                      <div>
                        <dt>Sensibilidad al precio</dt>
                        <dd>
                          −10% ({fmt(sim.sensitivity.priceMinus.price, 2)}): {money(sim.sensitivity.priceMinus.best.margin, cur)} el día {sim.sensitivity.priceMinus.best.days} · +10% ({fmt(sim.sensitivity.pricePlus.price, 2)}): {money(sim.sensitivity.pricePlus.best.margin, cur)} el día {sim.sensitivity.pricePlus.best.days}
                        </dd>
                      </div>
                    </dl>
                    <div className="scenario-note">
                      Supuestos: {sim.assumptions.headCount} animales de {sim.assumptions.currentWeight} kg; GDP {sim.assumptions.gdpPerDay} kg/día ({sim.assumptions.gdpSource}); costo diario {sim.assumptions.dailyCostPerHead} por cabeza ({sim.assumptions.dailyCostSource}); precio {sim.assumptions.pricePerKg} ({sim.assumptions.priceSource}); costo acumulado {money(Number(sim.assumptions.accumulatedCost), cur)}.
                    </div>
                  </>
                )}
                {!sim && !simError && <p className="form-note">Elegí un lote activo con animales para simular.</p>}
              </Panel>
            </div>
            {sim && (
              <Panel title="Curva de margen" subtitle="Margen estimado por fecha de venta, con precio ±10%">
                <MarginChart currency={cur} points={sim.curve.map((pt, i) => ({ days: pt.days, date: pt.date, margin: pt.margin, marginMinus: pt.margin - (sim.curve[i].revenue * 0.1), marginPlus: pt.margin + sim.curve[i].revenue * 0.1 }))} />
              </Panel>
            )}
          </>
        )}
      </Tabs>
      <div className="reference-banner">
        <CalendarDays size={19} />
        <span>
          <strong>Precios de referencia</strong>
          <small>
            {Object.values(s.prices).length ? `Última actualización: ${dateLabel(Object.values(s.prices).sort((a, b) => b.date.localeCompare(a.date))[0].date, true)}` : "Sin precios cargados"}
          </small>
        </span>
        <button className="text-link" onClick={() => p.onNavigate("settings")}>
          Editar referencias
          <ArrowRight size={15} />
        </button>
      </div>
    </>
  );
}

// ---------- Campos ----------

function Farms(p: ViewsProps) {
  return (
    <>
      <div className="section-toolbar">
        <p className="muted">Cada establecimiento, con sus propios registros y su propio equipo.</p>
        <Btn variant="primary" onClick={() => p.onAction({ type: "farm" })}>
          <Plus size={17} />
          Nuevo campo
        </Btn>
      </div>
      <div className="farm-cards">
        {p.farms.map((f) => (
          <Panel key={f.id}>
            <div className="farm-card">
              <span className="farm-card-icon">
                <MapPin size={27} />
              </span>
              {f.id === p.snapshot.farm.id && <Badge>Campo activo</Badge>}
              <h2>{f.name}</h2>
              <p>
                {f.location || "Sin ubicación"} · {fmt(f.hectares)} ha · {ROLE_LABELS[f.role]}
              </p>
              {f.id === p.snapshot.farm.id && (
                <div className="farm-numbers">
                  <span>
                    <strong>{p.snapshot.totals.activeLots}</strong> lotes activos
                  </span>
                  <span>
                    <strong>{p.snapshot.totals.activeHeads}</strong> animales
                  </span>
                </div>
              )}
              <Btn variant={f.id === p.snapshot.farm.id ? "" : "primary"} onClick={() => p.onFarm(f.id)}>
                Entrar al campo
                <ArrowRight size={16} />
              </Btn>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

// ---------- Configuración ----------

type Members = { members: { userId: string; name: string; email: string; role: string; since: string }[]; pending: { id: string; email: string; role: string; expiresAt: string }[] };

function Configuration(p: ViewsProps) {
  const s = p.snapshot;
  const cur = currencySymbol(s.farm.currency);
  const [tab, setTab] = useState("farm");
  const [saved, setSaved] = useState("");
  const [members, setMembers] = useState<Members | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [busy, setBusy] = useState(false);
  const farmId = s.farm.id;
  const loadMembers = () => api.get<Members>(farmPath(farmId, "/members")).then(setMembers).catch(() => setMembers(null));
  const loadPrices = () => (p.perms.canMoney ? api.get<typeof prices>(farmPath(farmId, "/prices")).then(setPrices).catch(() => setPrices([])) : Promise.resolve());
  useEffect(() => {
    loadMembers();
    loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, s]);

  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      setSaved(message);
      toast.success(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="page-tabs" variant="line">
        <TabsTrigger value="farm">Establecimiento</TabsTrigger>
        <TabsTrigger value="users">Usuarios y roles</TabsTrigger>
        <TabsTrigger value="owners">Propietarios y banco</TabsTrigger>
        {p.perms.canMoney && <TabsTrigger value="prices">Precios de referencia</TabsTrigger>}
        <TabsTrigger value="alerts">Alertas</TabsTrigger>
        <TabsTrigger value="categories">Categorías y unidades</TabsTrigger>
        <TabsTrigger value="account">Mi cuenta</TabsTrigger>
      </TabsList>
      <TabsContent value="farm">
        <Panel title="Los datos de tu campo" subtitle="Información del establecimiento activo">
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              run(
                () =>
                  api.patch(farmPath(farmId, ""), {
                    name: d.get("name"),
                    location: d.get("location"),
                    hectares: d.get("ha"),
                    currency: d.get("currency"),
                    timezone: d.get("timezone"),
                    allocationMethod: d.get("allocation"),
                    withdrawalPolicy: d.get("withdrawal"),
                  }).then(() => p.onRefresh()),
                "Cambios guardados",
              );
            }}
          >
            <div className="form-grid">
              <Field label="Nombre del campo">
                <input name="name" defaultValue={s.farm.name} required disabled={!p.perms.canManage} />
              </Field>
              <Field label="Ubicación">
                <input name="location" defaultValue={s.farm.location} disabled={!p.perms.canManage} />
              </Field>
              <Field label="Superficie (hectáreas)">
                <input name="ha" type="number" min="0" step="0.1" defaultValue={s.farm.hectares} disabled={!p.perms.canManage} />
              </Field>
              <Field label="Moneda">
                <select name="currency" defaultValue={s.farm.currency} disabled={!p.perms.canManage}>
                  {["USD", "UYU", "ARS", "BRL", "EUR"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Zona horaria">
                <input name="timezone" defaultValue={s.farm.timezone} disabled={!p.perms.canManage} />
              </Field>
              <Field label="Prorrateo de gastos globales">
                <select name="allocation" defaultValue={s.farm.allocationMethod} disabled={!p.perms.canManage}>
                  <option value="head_days">Por cabeza-día del mes del gasto</option>
                  <option value="heads">Por cabezas presentes el día del gasto</option>
                </select>
              </Field>
              <Field label="Venta con retiro sanitario vigente">
                <select name="withdrawal" defaultValue={s.farm.withdrawalPolicy} disabled={!p.perms.canManage}>
                  <option value="block">Bloquear la venta</option>
                  <option value="warn">Advertir y pedir confirmación</option>
                </select>
              </Field>
            </div>
            {p.perms.canManage && (
              <div className="form-actions">
                {saved && (
                  <span className="gain">
                    <Check size={15} />
                    {saved}
                  </span>
                )}
                <Btn type="submit" variant="primary" disabled={busy}>
                  Guardar cambios
                </Btn>
              </div>
            )}
          </form>
        </Panel>
        <Panel
          title="Potreros"
          subtitle="Opcionales, para asignar lotes"
          action={
            p.perms.canManage ? (
              <Btn onClick={() => p.onAction({ type: "paddock" })}>
                <Plus size={15} />
                Potrero
              </Btn>
            ) : undefined
          }
        >
          <DataTable
            headers={["Potrero", "Hectáreas", "Lotes", ""]}
            rows={s.paddocks.map((pd) => [
              pd.name,
              fmt(pd.hectares, 1),
              s.lots.filter((l) => l.paddockId === pd.id).map((l) => l.name).join(", ") || "–",
              p.perms.canManage ? (
                <button key="d" className="icon-btn" aria-label={`Eliminar ${pd.name}`} onClick={() => confirm(`¿Eliminar el potrero ${pd.name}?`) && run(() => api.delete(farmPath(farmId, `/paddocks/${pd.id}`)).then(() => p.onRefresh()), "Potrero eliminado")}>
                  <Trash2 size={15} />
                </button>
              ) : (
                ""
              ),
            ])}
          />
          {!s.paddocks.length && <p className="panel-padding muted">Todavía no hay potreros cargados.</p>}
        </Panel>
        {s.role === "owner" && (
          <Panel title="Zona de riesgo">
            <div className="panel-padding">
              <Btn
                variant="danger"
                onClick={() => {
                  if (prompt(`Escribí el nombre del campo (${s.farm.name}) para eliminarlo con todos sus datos.`) !== s.farm.name) return;
                  run(() => api.delete(farmPath(farmId, "")).then(() => window.location.reload()), "Campo eliminado");
                }}
              >
                Eliminar este campo
              </Btn>
            </div>
          </Panel>
        )}
      </TabsContent>
      <TabsContent value="users">
        <Panel
          title="El equipo de tu campo"
          subtitle="Cada persona tiene un rol por campo; los permisos se validan en el servidor."
          action={
            p.perms.canManage ? (
              <Btn onClick={() => p.onAction({ type: "invite" })}>
                <Plus size={16} />
                Invitar
              </Btn>
            ) : undefined
          }
        >
          <DataTable
            headers={["Usuario", "Correo", "Rol", ""]}
            rows={(members?.members || []).map((m) => [
              m.name,
              m.email,
              p.perms.canManage && m.role !== "owner" && m.userId !== p.user.id ? (
                <select key="r" value={m.role} onChange={(e) => run(() => api.patch(farmPath(farmId, `/members/${m.userId}`), { role: e.target.value }).then(loadMembers), "Rol actualizado")}>
                  {["admin", "operator", "viewer"].map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge key="b" tone={m.role === "owner" ? "green" : "gray"}>
                  {ROLE_LABELS[m.role]}
                </Badge>
              ),
              p.perms.canManage && m.role !== "owner" && m.userId !== p.user.id ? (
                <button key="d" className="icon-btn" aria-label={`Quitar a ${m.name}`} onClick={() => confirm(`¿Quitar a ${m.name} del campo?`) && run(() => api.delete(farmPath(farmId, `/members/${m.userId}`)).then(loadMembers), "Persona quitada del campo")}>
                  <Trash2 size={15} />
                </button>
              ) : (
                ""
              ),
            ])}
          />
          {members?.pending.length ? (
            <>
              <p className="panel-padding muted">Invitaciones pendientes</p>
              <DataTable
                headers={["Correo", "Rol", "Vence", ""]}
                rows={members.pending.map((i) => [
                  i.email,
                  ROLE_LABELS[i.role],
                  dateLabel(i.expiresAt, true),
                  p.perms.canManage ? (
                    <button key="d" className="text-link" onClick={() => run(() => api.delete(farmPath(farmId, `/invitations/${i.id}`)).then(loadMembers), "Invitación anulada")}>
                      Anular
                    </button>
                  ) : (
                    ""
                  ),
                ])}
              />
            </>
          ) : null}
          <div className="settings-form">
            <p className="form-note">
              <strong>Propietario</strong> y <strong>administrador</strong>: acceso completo. <strong>Operario</strong>: carga pesadas, gastos, sanidad y movimientos operativos sin ver montos ni análisis. <strong>Lector</strong>: solo consulta.
            </p>
          </div>
        </Panel>
      </TabsContent>
      {p.perms.canMoney && (
        <TabsContent value="prices">
          <Panel
            title="Una referencia para decidir"
            subtitle={`Precios por kilo · ${s.farm.currency}. Para valuar se usa el último precio en pie de cada categoría a la fecha.`}
            action={
              p.perms.canManage ? (
                <div className="detail-actions">
                  <label className="btn">
                    <Upload size={15} />
                    Importar CSV
                    <input
                      type="file"
                      accept=".csv,.txt"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const form = new FormData();
                        form.append("file", f);
                        run(() => api.upload(farmPath(farmId, "/prices"), form).then(() => Promise.all([loadPrices(), p.onRefresh()])), "Precios importados");
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <Btn variant="primary" onClick={() => p.onAction({ type: "price" })}>
                    <Plus size={15} />
                    Precio
                  </Btn>
                </div>
              ) : undefined
            }
          >
            <div className="metric-grid">
              {CATEGORIES.filter((c) => c !== "otro").map((c) => (
                <Metric key={c} label={CATEGORY_LABELS[c]} value={s.prices[c] ? money(s.prices[c].pricePerKg, cur, 2) : "–"} unit="/ kg" icon={<TrendingUp size={17} />} foot={s.prices[c] ? `${dateLabel(s.prices[c].date, true)} · ${s.prices[c].source}` : "Sin referencia"} />
              ))}
            </div>
            <DataTable
              headers={["Fecha", "Categoría", `Precio (${cur}/kg)`, "Base", "Fuente", ""]}
              rows={prices.slice(0, 60).map((pr) => [
                dateLabel(pr.date, true),
                catLabel(pr.category),
                fmt(pr.pricePerKg, 2),
                BASIS_LABELS[pr.basis] ?? pr.basis,
                `${pr.source}${pr.provider ? ` · ${pr.provider}` : ""}`,
                p.perms.canManage ? (
                  <button key="d" className="icon-btn" aria-label="Eliminar precio" onClick={() => run(() => api.delete(farmPath(farmId, `/prices/${pr.id}`)).then(() => Promise.all([loadPrices(), p.onRefresh()])), "Precio eliminado")}>
                    <Trash2 size={15} />
                  </button>
                ) : (
                  ""
                ),
              ])}
            />
            <p className="panel-padding muted">
              Los lunes a la noche se cargan solos los promedios semanales de ACG (acg.com.uy): reposición en pie y ganado gordo en cuarta balanza. CSV con columnas <code>fecha, categoria, precio</code> (y opcional <code>moneda</code>).
            </p>
          </Panel>
        </TabsContent>
      )}
      <TabsContent value="owners">
        <OwnersPanel {...p} run={run} busy={busy} />
      </TabsContent>
      <TabsContent value="alerts">
        <Panel title="Alertas del campo" subtitle="Se muestran en el resumen; opcionalmente se envían por correo a los miembros.">
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              run(() => api.patch(farmPath(farmId, ""), { alertConfig: { staleDays: Number(d.get("staleDays")), withdrawalSoonDays: Number(d.get("soonDays")), calvingSoonDays: Number(d.get("calvingDays")), email: d.get("email") === "on" } }).then(() => p.onRefresh()), "Alertas actualizadas");
            }}
          >
            <div className="form-grid">
              <Field label="Avisar animales sin pesar hace más de (días)">
                <input name="staleDays" type="number" min="1" max="365" defaultValue={s.farm.alertConfig.staleDays} disabled={!p.perms.canManage} />
              </Field>
              <Field label="Avisar retiros por vencer con (días) de anticipación">
                <input name="soonDays" type="number" min="0" max="90" defaultValue={s.farm.alertConfig.withdrawalSoonDays} disabled={!p.perms.canManage} />
              </Field>
              <Field label="Avisar partos estimados con (días) de anticipación">
                <input name="calvingDays" type="number" min="0" max="120" defaultValue={s.farm.alertConfig.calvingSoonDays ?? 30} disabled={!p.perms.canManage} />
              </Field>
            </div>
            <label className="check-label">
              <input type="checkbox" name="email" defaultChecked={s.farm.alertConfig.email} disabled={!p.perms.canManage} />
              Enviar el resumen de alertas por correo a los miembros del campo
            </label>
            {p.perms.canManage && (
              <div className="form-actions">
                <Btn onClick={() => run(() => api.post<{ sent: number; reason?: string }>(farmPath(farmId, "/alerts")).then((r) => toast.info(r.sent ? `Enviado a ${r.sent} persona(s)` : `No se envió: ${r.reason}`)), "Resumen procesado")}>Enviar resumen ahora</Btn>
                <Btn type="submit" variant="primary" disabled={busy}>
                  Guardar
                </Btn>
              </div>
            )}
          </form>
        </Panel>
      </TabsContent>
      <TabsContent value="categories">
        <Panel title="Categorías y unidades del campo">
          <DataTable
            headers={["Tipo", "Valores disponibles"]}
            rows={[
              ["Categorías animales", CATEGORIES.map((c) => CATEGORY_LABELS[c]).join(" · ")],
              ["Peso y superficie", `Kilogramos (${s.farm.weightUnit}) · Hectáreas (ha)`],
              ["Insumos", "kg · litros · dosis · unidades · horas · ha · jornales"],
              ["Gastos", Object.values(EXPENSE_CATEGORY_LABELS).join(" · ") + " (pasturas: fertilizantes, semillas, agroquímicos)"],
              ["Sanidad", Object.values(HEALTH_TYPE_LABELS).join(" · ")],
              ["Rangos de peso razonables", "Terneros 60–320 · Novillos 180–700 · Vaquillonas 150–520 · Vacas 300–800 · Toros 400–1200 kg (fuera de rango se advierte, no se bloquea)"],
            ]}
          />
        </Panel>
      </TabsContent>
      <TabsContent value="account">
        <Panel title="Mi cuenta" subtitle={p.user.email}>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              run(() => api.patch("/api/auth/me", { name: d.get("name") }), "Nombre actualizado");
            }}
          >
            <Field label="Nombre">
              <input name="name" defaultValue={p.user.name} required />
            </Field>
            <div className="form-actions">
              <Btn type="submit" variant="primary" disabled={busy}>
                Guardar
              </Btn>
            </div>
          </form>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const form = e.currentTarget;
              run(() => api.post("/api/auth/password", { current: d.get("current"), next: d.get("next") }).then(() => form.reset()), "Contraseña actualizada");
            }}
          >
            <div className="form-grid">
              <Field label="Contraseña actual">
                <input name="current" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="Nueva contraseña">
                <input name="next" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
            </div>
            <div className="form-actions">
              <Btn type="submit" disabled={busy}>
                Cambiar contraseña
              </Btn>
            </div>
          </form>
        </Panel>
      </TabsContent>
    </Tabs>
  );
}

// ---------- Alertas (todas) y cola offline ----------

// ---------- Propietarios (DICOSE) y caravanas a nombre del banco ----------

function OwnersPanel(p: ViewsProps & { run: (fn: () => Promise<unknown>, message: string) => Promise<void>; busy: boolean }) {
  const s = p.snapshot;
  const farmId = s.farm.id;
  const [eids, setEids] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [bulkMode, setBulkMode] = useState<"owner" | "pledge" | "release">("owner");
  const [result, setResult] = useState<{ updated: number; missing: string[] } | null>(null);
  const pledged = s.animals.filter((a) => a.status === "activo" && a.pledge);
  const byBank = new Map<string, AnimalView[]>();
  for (const a of pledged) byBank.set(a.pledge!.bank, [...(byBank.get(a.pledge!.bank) || []), a]);
  const ownerName = (id: string | undefined) => s.owners.find((o) => o.id === id)?.name || "–";

  async function applyBulk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const list = eids
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!list.length) return toast.error("Pegá al menos una caravana.");
    const payload = bulkMode === "owner" ? { eids: list, ownerId: bulkOwner || null } : bulkMode === "pledge" ? { eids: list, pledge: { bank, ref: ref || null } } : { eids: list, pledge: null };
    if (bulkMode === "pledge" && !bank.trim()) return toast.error("Indicá el banco.");
    await p.run(
      () =>
        api.patch<{ updated: number; missing: string[] }>(farmPath(farmId, "/animals/bulk"), payload).then((r) => {
          setResult(r);
          p.onRefresh();
        }),
      "Caravanas actualizadas",
    );
  }

  return (
    <>
      <Panel
        title="Propietarios"
        subtitle="Cada animal puede pertenecer a un propietario distinto, identificado por su DICOSE."
        action={
          p.perms.canWrite ? (
            <Btn onClick={() => p.onAction({ type: "owner" })}>
              <Plus size={15} />
              Propietario
            </Btn>
          ) : undefined
        }
      >
        <DataTable
          headers={["Propietario", "DICOSE", "Animales activos", "A nombre del banco", "Notas", ""]}
          rows={s.owners.map((o) => [
            o.name,
            o.dicose || "–",
            String(o.activeAnimals),
            o.pledgedAnimals ? <Badge key="p" tone="amber">{o.pledgedAnimals}</Badge> : "–",
            o.notes || "–",
            <span key="a" className="row-actions">
              {p.perms.canWrite && (
                <button className="icon-btn" aria-label={`Editar ${o.name}`} onClick={() => p.onAction({ type: "editOwner", record: o.id })}>
                  <Pencil size={15} />
                </button>
              )}
              {p.perms.canManage && (
                <button className="icon-btn" aria-label={`Eliminar ${o.name}`} onClick={() => confirm(`¿Eliminar a ${o.name}? Sus animales quedan sin propietario.`) && p.run(() => api.delete(farmPath(farmId, `/owners/${o.id}`)).then(() => p.onRefresh()), "Propietario eliminado")}>
                  <Trash2 size={15} />
                </button>
              )}
            </span>,
          ])}
        />
        {!s.owners.length && <p className="panel-padding muted">Todavía no hay propietarios cargados. Los animales sin propietario se cuentan aparte: {s.animals.filter((a) => a.status === "activo" && !a.owner).length} activos.</p>}
      </Panel>
      <Panel title="Caravanas a nombre del banco" subtitle={`${pledged.length} animales activos prendados por préstamos`}>
        {[...byBank.entries()].map(([b, list]) => (
          <div key={b} className="bank-group">
            <div className="bank-group-heading">
              <Landmark size={16} />
              <strong>{b}</strong>
              <span className="muted">{list.length} caravanas</span>
              {[...new Set(list.map((a) => a.pledge!.ref).filter(Boolean))].map((r) => (
                <Badge key={r} tone="gray">
                  {r}
                </Badge>
              ))}
            </div>
            <div className="eid-cloud">
              {list.map((a) => (
                <button key={a.id} className="eid-chip" title={`${ownerName(a.owner?.id)}${a.pledge!.since ? ` · desde ${dateLabel(a.pledge!.since, true)}` : ""}`} onClick={() => (p.onNavigate("animals"), p.setSelected(a.id))}>
                  {a.eid}
                  <small>{a.visual}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!pledged.length && <p className="panel-padding muted">Ningún animal activo está a nombre del banco.</p>}
        {pledged.length > 0 && (
          <div className="panel-padding">
            <button className="text-link" onClick={() => navigator.clipboard?.writeText(pledged.map((a) => a.eid).join("\n")).then(() => toast.success("Caravanas copiadas"))}>
              Copiar la lista de caravanas
            </button>
          </div>
        )}
      </Panel>
      {p.perms.canWrite && (
        <Panel title="Asignación por lista de caravanas" subtitle="Pegá las caravanas (una por línea o separadas por coma) para asignar propietario o marcar la prenda bancaria.">
          <form className="settings-form" onSubmit={applyBulk}>
            <div className="form-grid">
              <Field label="Acción">
                <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as typeof bulkMode)}>
                  <option value="owner">Asignar propietario</option>
                  {p.perms.canManage && <option value="pledge">Marcar a nombre del banco</option>}
                  {p.perms.canManage && <option value="release">Liberar prenda bancaria</option>}
                </select>
              </Field>
              {bulkMode === "owner" && (
                <Field label="Propietario">
                  <select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}>
                    <option value="">Sin propietario</option>
                    {s.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.dicose ? ` · ${o.dicose}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {bulkMode === "pledge" && (
                <>
                  <Field label="Banco">
                    <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Ej. BROU" required />
                  </Field>
                  <Field label="Referencia del préstamo">
                    <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Opcional" />
                  </Field>
                </>
              )}
            </div>
            <Field label="Caravanas">
              <textarea rows={5} value={eids} onChange={(e) => setEids(e.target.value)} placeholder={"858000012345001\n858000012345002"} />
            </Field>
            {result && (
              <p className="form-note">
                {result.updated} caravanas actualizadas.{result.missing.length ? ` No encontradas en este campo: ${result.missing.join(", ")}.` : ""}
              </p>
            )}
            <div className="form-actions">
              <Btn type="submit" variant="primary" disabled={p.busy}>
                Aplicar
              </Btn>
            </div>
          </form>
        </Panel>
      )}
    </>
  );
}

function AlertsPage(p: ViewsProps) {
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  useEffect(() => {
    const read = () => setQueue(queueFor(p.snapshot.farm.id));
    read();
    window.addEventListener("rodeo:queue", read);
    return () => window.removeEventListener("rodeo:queue", read);
  }, [p.snapshot.farm.id]);
  return (
    <>
      {queue.length > 0 && (
        <Panel title="Pendiente de sincronizar" subtitle="Registros cargados sin conexión en este dispositivo">
          <DataTable headers={["Cuándo", "Registro"]} rows={queue.map((q) => [dateLabel(q.at, true), q.label])} />
          <p className="panel-padding muted">
            <CloudOff size={14} /> Se envían automáticamente al recuperar la conexión. Si el estado cambió en el servidor, se aplica igual (última escritura gana) y se avisa.
          </p>
        </Panel>
      )}
      <FarmAlerts snapshot={p.snapshot} onAction={p.onAction} onNavigate={p.onNavigate} onSelect={p.setSelected} canMoney={p.perms.canMoney} limit={100} />
    </>
  );
}

function Help() {
  return (
    <Panel title="Un lugar para cada registro" subtitle="Guía rápida de Rodeo">
      <div className="help-grid">
        {[
          [Scale, "Pesadas sin vueltas", "Importá el Excel del lector (o un CSV), revisá las observaciones fila por fila y confirmá. También podés cargar animal por animal o el promedio de un lote."],
          [Layers, "Tu lote, en perspectiva", "Entrá a un lote para revisar su evolución, costos, tratamientos y la proyección hacia el peso objetivo. Cerralo cuando no queden animales y guardá su resultado."],
          [MapPin, "Cada campo es independiente", "Usá el selector de la barra lateral para cambiar de establecimiento. Cada campo tiene su equipo, sus roles y sus registros; el servidor lo valida en cada consulta."],
          [Bell, "Alertas y sin conexión", "El resumen avisa animales sin pesar, retiros por vencer e importaciones a medio hacer. Sin red, las pesadas, gastos y eventos sanitarios quedan en cola y se sincronizan solos."],
        ].map(([Icon, title, text]) => {
          const I = Icon as typeof Scale;
          return (
            <div key={String(title)}>
              <I size={23} />
              <h3>{String(title)}</h3>
              <p>{String(text)}</p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export { daysSince };

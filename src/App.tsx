import { useState, useEffect, useCallback, useRef, useSyncExternalStore, lazy, Suspense } from "react";
import {
  LayoutDashboard,
  Layers,
  Beef,
  Scale,
  ArrowLeftRight,
  Receipt,
  HeartPulse,
  ChartNoAxesCombined,
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Bell,
  ArrowUpRight,
  ArrowRight,
  Upload,
  MapPin,
  CircleHelp,
  CloudCheck,
  CloudOff,
  LogOut,
  TrendingUp,
  Weight,
  Wallet,
  Clock3,
  Sprout,
  RefreshCw,
} from "lucide-react";
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Brand, Btn, Badge, Panel, Metric, Pick, DataTable, Empty } from "@/components/rodeo/ui";
import { WeightChart, Composition } from "@/components/rodeo/charts";
import { FarmAlerts } from "@/components/rodeo/alerts";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import type { Action, Perms } from "@/components/rodeo/views";
import { api, ApiError, farmPath } from "@/lib/api";
import { fmt, money, currencySymbol, dateLabel, daysSince } from "@/lib/format";
import { ROLE_LABELS } from "@rodeo/shared";
import { queueFor, syncQueue, registerServiceWorker } from "@/lib/offline";
import { DemoPanel } from "@/demo/DemoPanel";
import type { FarmSnapshot, FarmSummary, SessionUserView } from "@rodeo/shared";

const WorkspaceViews = lazy(() => import("@/components/rodeo/views").then((m) => ({ default: m.WorkspaceViews })));
const ActionDialog = lazy(() => import("@/components/rodeo/forms").then((m) => ({ default: m.ActionDialog })));
const Auth = lazy(() => import("@/components/rodeo/auth").then((m) => ({ default: m.Auth })));

const navigation = [
  { id: "dashboard", name: "Resumen", icon: LayoutDashboard },
  { id: "lots", name: "Lotes", icon: Layers },
  { id: "animals", name: "Animales", icon: Beef },
  { id: "weighings", name: "Pesadas", icon: Scale },
  { id: "movements", name: "Compras y ventas", icon: ArrowLeftRight },
  { id: "expenses", name: "Gastos", icon: Receipt },
  { id: "health", name: "Sanidad", icon: HeartPulse },
  { id: "analytics", name: "Análisis", icon: ChartNoAxesCombined },
];
const PAGES = [...navigation.map((n) => n.id), "farms", "settings", "help", "alerts"];
const FARM_KEY = "rodeo-active-farm";
const SNAPSHOT_KEY = "rodeo-snapshot-cache";

export default function Page() {
  return (
    <SidebarProvider style={{ "--sidebar-width": "238px" } as React.CSSProperties}>
      <App />
    </SidebarProvider>
  );
}

type Session = { user: SessionUserView | null; farms: FarmSummary[] };

function permsFor(role: string): Perms {
  return {
    canWrite: ["owner", "admin", "operator"].includes(role),
    canMoney: ["owner", "admin", "viewer"].includes(role),
    canManage: ["owner", "admin"].includes(role),
    canEditMovements: ["owner", "admin"].includes(role),
  };
}

function hashParams() {
  const h = window.location.hash.slice(1);
  const [page, query] = h.split("?");
  const params = new URLSearchParams(query || (page.includes("=") ? page : ""));
  return { page: page.includes("=") ? "" : page, reset: params.get("reset"), invite: params.get("invite") };
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [farmId, setFarmId] = useState<string>("");
  const [snapshot, setSnapshot] = useState<FarmSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [page, setPage] = useState(() => (typeof window !== "undefined" && PAGES.includes(hashParams().page) ? hashParams().page : "dashboard"));
  const [period, setPeriod] = useState("Este mes");
  const [tokens, setTokens] = useState<{ reset: string | null; invite: string | null }>(() =>
    typeof window === "undefined" ? { reset: null, invite: null } : { reset: hashParams().reset, invite: hashParams().invite },
  );
  const farmIdRef = useRef("");
  useEffect(() => {
    farmIdRef.current = farmId;
  }, [farmId]);
  // La cola offline vive en localStorage; se observa como store externo.
  const queueIds = useSyncExternalStore(
    (cb) => {
      window.addEventListener("rodeo:queue", cb);
      return () => window.removeEventListener("rodeo:queue", cb);
    },
    () => (farmId ? queueFor(farmId).map((q) => q.clientId).join(",") : ""),
    () => "",
  );
  const queueCount = queueIds ? queueIds.split(",").length : 0;
  const { setOpenMobile } = useSidebar();

  const farms = session?.farms || [];
  const farm = farms.find((f) => f.id === farmId) || farms[0];
  const role = snapshot?.role || farm?.role || "viewer";
  const perms = permsFor(role);
  const cur = currencySymbol(snapshot?.farm.currency || farm?.currency || "USD");

  const go = useCallback(
    (p: string) => {
      setPage(p);
      setSelected(null);
      setOpenMobile(false);
      window.history.replaceState(null, "", "#" + p);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [setOpenMobile],
  );

  // Carga la sesión y elige el campo activo (el último usado si sigue disponible).
  const loadSession = useCallback(async () => {
    try {
      const s = await api.get<Session>("/api/auth/me");
      setSession(s);
      if (s.user) {
        let stored = "";
        try {
          stored = localStorage.getItem(FARM_KEY) || "";
        } catch {
          /* sin almacenamiento */
        }
        const next = s.farms.find((f) => f.id === (farmIdRef.current || stored))?.id || s.farms[0]?.id || "";
        if (next !== farmIdRef.current) {
          setFarmId(next);
          if (!next) setSnapshot(null);
        }
      }
      return s;
    } catch {
      setSession({ user: null, farms: [] });
      return null;
    }
  }, []);

  const refresh = useCallback(
    async (id?: string) => {
      const target = id || farmId;
      if (!target) return;
      setLoadingSnapshot(true);
      try {
        const snap = await api.get<FarmSnapshot>(farmPath(target, "/snapshot"));
        setSnapshot(snap);
        setSnapshotError("");
        try {
          localStorage.setItem(SNAPSHOT_KEY + ":" + target, JSON.stringify(snap));
        } catch {
          /* sin espacio: sin caché offline */
        }
      } catch (e) {
        const err = e as ApiError;
        if (!navigator.onLine || err.status === undefined) {
          // Sin red: se muestra la última copia guardada del campo.
          try {
            const cached = localStorage.getItem(SNAPSHOT_KEY + ":" + target);
            if (cached) {
              setSnapshot(JSON.parse(cached));
              setSnapshotError("");
              return;
            }
          } catch {
            /* sin caché */
          }
        }
        setSnapshotError(err.message || "No se pudo cargar el campo.");
      } finally {
        setLoadingSnapshot(false);
      }
    },
    [farmId],
  );

  const doSync = useCallback(
    async (id: string) => {
      const results = await syncQueue(id);
      if (!results.length) return;
      const ok = results.filter((r) => r.status === "ok").length;
      const conflicts = results.filter((r) => r.status === "conflicto");
      const errors = results.filter((r) => r.status === "error");
      if (ok) toast.success(`${ok} registro(s) sincronizados`);
      for (const c of conflicts) toast.warning(`Conflicto al sincronizar: ${c.message}`);
      for (const e of errors) toast.error(`No se pudo sincronizar: ${e.message}`);
      refresh(id);
    },
    [refresh],
  );

  // Arranque: sesión, estado de red, PWA.
  useEffect(() => {
    registerServiceWorker();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unauthorized = () => setSession({ user: null, farms: [] });
    window.addEventListener("rodeo:unauthorized", unauthorized);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    loadSession();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("rodeo:unauthorized", unauthorized);
    };
  }, [loadSession]);

  // Cambio de campo activo: recordar y cargar su snapshot.
  useEffect(() => {
    if (!farmId || !session?.user) return;
    try {
      localStorage.setItem(FARM_KEY, farmId);
    } catch {
      /* sin almacenamiento */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga del campo activo
    refresh(farmId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, session?.user?.id]);

  // Al recuperar la conexión, sincronizar la cola.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincronización al recuperar red
    if (online && farmId && session?.user) doSync(farmId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, farmId, session?.user?.id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPage("animals");
        setSelected(null);
        setTimeout(() => document.querySelector<HTMLInputElement>(".filter-search input")?.focus(), 100);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const changeFarm = (id: string) => {
    setFarmId(id);
    setSnapshot(null);
    setSelected(null);
    setAction(null);
    go("dashboard");
  };

  const onSaved = (message?: string) => {
    if (message) toast.success(message);
    refresh();
    if (session?.user) loadSession();
  };

  async function logout() {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setSession({ user: null, farms: [] });
      setSnapshot(null);
      setFarmId("");
    }
  }

  const clearTokens = () => {
    setTokens({ reset: null, invite: null });
    window.history.replaceState(null, "", "#dashboard");
  };

  if (session === undefined || session === null) return <div className="loading-view" role="status">Preparando tu campo...</div>;
  if (!session.user || tokens.invite) {
    return (
      <Suspense fallback={<div className="loading-view" role="status">Preparando el acceso...</div>}>
        <Auth
          key={`${tokens.reset}-${tokens.invite}`}
          user={session.user}
          resetToken={tokens.reset}
          inviteToken={tokens.invite}
          onEnter={async () => {
            clearTokens();
            const s = await loadSession();
            if (s?.farms.length) setFarmId(s.farms[0].id);
          }}
        />
        <Toaster position="bottom-right" richColors theme="light" />
      </Suspense>
    );
  }

  const s = snapshot;
  const activeLots = s?.lots.filter((l) => l.status === "activo") || [];
  const count = s?.totals.activeHeads || 0;
  const weight = s?.totals.totalWeight || 0;
  const expenses = (s?.expenses || [])
    .filter((e) => {
      const today = s?.today || "";
      if (period === "Este año") return e.date.slice(0, 4) === today.slice(0, 4);
      if (period === "Últimos 3 meses") return daysSince(e.date, today) <= 92;
      return e.date.slice(0, 7) === today.slice(0, 7);
    })
    .reduce((acc, e) => acc + (e.total || 0), 0);
  // Evolución mensual del peso promedio de los lotes activos: para cada mes se
  // toma la última pesada conocida de cada lote (arrastrada) ponderada por animales.
  const farmHistory = (() => {
    if (!s) return [];
    const lots = activeLots.filter((l) => l.history.length);
    if (!lots.length) return [];
    const first = lots.map((l) => l.history[0].date).sort()[0];
    const months: string[] = [];
    for (let m = first.slice(0, 7); m <= s.today.slice(0, 7); ) {
      months.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
    return months
      .map((m) => {
        const end = m === s.today.slice(0, 7) ? s.today : m + "-31";
        let sum = 0;
        let n = 0;
        for (const l of lots) {
          const pt = [...l.history].filter((h) => h.date <= end).pop();
          if (pt) {
            sum += pt.avgWeight * pt.count;
            n += pt.count;
          }
        }
        return n ? { date: end, weight: Math.round((sum / n) * 10) / 10, count: n } : null;
      })
      .filter((x): x is { date: string; weight: number; count: number } => x !== null);
  })();
  const lastWeighing = activeLots.map((l) => l.lastWeighingDate).filter(Boolean).sort().pop() || null;

  return (
    <>
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button className="mobile-sidebar-close" aria-label="Cerrar menú" onClick={() => setOpenMobile(false)}>
            Cerrar ×
          </button>
          <Brand />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="farm-switch">
                <span className="farm-icon">
                  <MapPin size={19} />
                </span>
                <span>
                  <small>ESTABLECIMIENTO</small>
                  <strong>{farm?.name || "Sin campo"}</strong>
                </span>
                <ChevronDown size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="farm-menu">
              {farms.map((f) => (
                <DropdownMenuItem key={f.id} onClick={() => changeFarm(f.id)}>
                  <MapPin />
                  {f.name}
                  {f.id === farmId && <Badge>Activo</Badge>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => go("farms")}>
                <Plus />
                Administrar campos
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">GESTIÓN DEL CAMPO</p>
          <SidebarMenu>
            {navigation
              .filter((n) => perms.canMoney || !["analytics"].includes(n.id))
              .map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton isActive={page === n.id} onClick={() => go(n.id)}>
                    <n.icon />
                    <span>{n.name}</span>
                    {n.id === "weighings" && s && <span className="nav-number">{s.sessions.length}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
          <div className="nav-bottom">
            <SidebarMenuButton onClick={() => go("settings")} isActive={page === "settings"}>
              <Settings />
              <span>Configuración</span>
            </SidebarMenuButton>
            <SidebarMenuButton onClick={() => go("help")} isActive={page === "help"}>
              <CircleHelp />
              <span>Ayuda y soporte</span>
              <ArrowUpRight />
            </SidebarMenuButton>
          </div>
          <div className="sidebar-note">
            <span className="live-dot" />
            Todo en su lugar<p>Tu campo, en perspectiva.</p>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="profile">
                <span className="avatar">
                  {session.user.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span>
                  <strong>{session.user.name}</strong>
                  <small>{ROLE_LABELS[role] || role}</small>
                </span>
                <ChevronDown size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => go("settings")}>
                <Settings />
                Mi cuenta y configuración
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => go("farms")}>
                <MapPin />
                Mis campos
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-trigger" />
            <span>{farm?.name || "Rodeo"}</span>
            <ChevronRight size={14} />
            <strong>{navigation.find((n) => n.id === page)?.name || { farms: "Mis campos", settings: "Configuración", help: "Ayuda", alerts: "Alertas" }[page] || "Mi campo"}</strong>
          </div>
          <div className="topbar-right">
            <button className="global-search" onClick={() => go("animals")}>
              <Search size={17} />
              <span>Buscar por caravana...</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className={`sync-status ${!online ? "offline-text" : ""}`} onClick={() => (online ? refresh() : undefined)} title={online ? "Actualizar" : "Sin conexión"}>
              {online ? loadingSnapshot ? <RefreshCw size={17} className="animate-spin" /> : <CloudCheck size={17} /> : <CloudOff size={17} />}
              {online ? (queueCount ? `${queueCount} por sincronizar` : "Sincronizado") : "Sin conexión"}
            </button>
            <button
              className="notification"
              aria-label="Ver alertas"
              onClick={() => go("alerts")}
            >
              <Bell size={19} />
              {s && s.alerts.length > 0 && <i />}
            </button>
          </div>
        </header>
        <main className="main-content">
          {!online && (
            <div className="notice amber">
              <CloudOff size={19} />
              <span>
                <strong>Sin conexión.</strong> {queueCount} registro(s) esperando sincronización. Podés seguir cargando pesadas, gastos y sanidad; se enviarán al volver la red.
              </span>
            </div>
          )}
          {snapshotError && (
            <div className="notice amber">
              <CloudOff size={19} />
              <span>
                <strong>No se pudo cargar el campo.</strong> {snapshotError}{" "}
                <button className="text-link" onClick={() => refresh()}>
                  Reintentar
                </button>
              </span>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">TU CAMPO, DE UN VISTAZO</div>
              <h1>
                {page === "dashboard"
                  ? "Cada dato, una mejor decisión."
                  : navigation.find((n) => n.id === page)?.name || { farms: "Mis establecimientos", settings: "Configuración del campo", help: "Estamos para ayudarte", alerts: "Alertas del campo" }[page] || "Tu establecimiento"}
              </h1>
              <p>
                <MapPin size={14} />
                {farm?.name || "Sin campo"}
                {farm?.location ? (
                  <>
                    <span>·</span>
                    {farm.location}
                  </>
                ) : null}
                {farm ? (
                  <>
                    <span>·</span>
                    {fmt(farm.hectares)} ha
                  </>
                ) : null}
                {s ? (
                  <>
                    <span>·</span>
                    {dateLabel(s.today, true)}
                  </>
                ) : null}
              </p>
            </div>
            <div className="heading-actions">
              {page === "dashboard" && perms.canMoney && <Pick label="Período" value={period} onChange={setPeriod} options={["Este mes", "Últimos 3 meses", "Este año"]} />}
              {perms.canWrite && s && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="btn primary">
                      <Plus size={17} />
                      Nuevo registro
                      <ChevronDown size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {[
                      ["Pesada manual", "manual"],
                      ["Importar pesada", "import"],
                      ["Pesada promedio de lote", "average"],
                      ["Gasto", "expense"],
                      ["Evento sanitario", "health"],
                      ["Alta de animal", "animal"],
                      ["Crear lote", "lot"],
                      ...(perms.canMoney
                        ? [
                            ["Compra", "purchase"],
                            ["Venta", "sale"],
                          ]
                        : []),
                      ["Nacimiento", "birth"],
                      ["Mover animales", "transfer"],
                    ].map(([label, t]) => (
                      <DropdownMenuItem key={t} onClick={() => setAction({ type: t })}>
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {!farm ? (
            <Panel>
              <Empty
                title="Todavía no tenés campos"
                description="Creá tu primer establecimiento o aceptá una invitación para empezar."
                action={
                  <Btn variant="primary" onClick={() => setAction({ type: "farm" })}>
                    <Plus size={17} />
                    Crear mi primer campo
                  </Btn>
                }
              />
            </Panel>
          ) : !s ? (
            <div className="loading-view" role="status">
              {snapshotError ? "" : "Cargando los registros del campo..."}
            </div>
          ) : page !== "dashboard" ? (
            <Suspense fallback={<div className="loading-view" role="status">Cargando los registros del campo...</div>}>
              <WorkspaceViews key={`${page}-${s.farm.id}`} page={page} snapshot={s} farms={farms} user={session.user} selected={selected} setSelected={setSelected} onAction={setAction} onFarm={changeFarm} onRefresh={onSaved} onNavigate={go} perms={perms} online={online} />
            </Suspense>
          ) : count === 0 && !s.lots.length ? (
            <Panel>
              <Empty
                title="Tu campo empieza acá"
                description="Creá tu primer lote para empezar a organizar los animales de este establecimiento."
                action={
                  perms.canWrite ? (
                    <Btn variant="primary" onClick={() => setAction({ type: "lot" })}>
                      <Plus size={17} />
                      Crear primer lote
                    </Btn>
                  ) : undefined
                }
              />
            </Panel>
          ) : (
            <>
              <div className="metric-grid">
                <Metric label="Animales en el campo" value={fmt(count)} unit="cab." icon={<Beef size={19} />} foot={`En ${activeLots.length} lotes activos`} />
                <Metric label="Kilos totales en pie" value={fmt(weight)} unit="kg" icon={<Weight size={19} />} foot={count ? `${fmt(weight / count, 1)} kg por animal` : "Sin pesadas"} />
                <Metric label="Ganancia diaria promedio" value={s.totals.avgGdp !== null ? fmt(s.totals.avgGdp, 2) : "–"} unit="kg/día" icon={<TrendingUp size={19} />} foot="Ponderada por animales" />
                {perms.canMoney ? (
                  <Metric label="Gastos del período" value={money(expenses, cur)} icon={<Wallet size={19} />} foot={`${period} · ${s.expenses.length} gastos registrados`} />
                ) : (
                  <Metric label="Alertas" value={String(s.alerts.length)} icon={<Bell size={19} />} foot="Pendientes en este campo" />
                )}
              </div>
              <div className="chart-grid">
                <Panel title="El crecimiento de tu rodeo" subtitle="Peso promedio del campo por fecha de pesada · kg por animal">
                  <div className="chart-stat">
                    <strong>
                      {count ? fmt(weight / count, 1) : "–"} <small>kg</small>
                    </strong>
                    {farmHistory.length >= 2 && (
                      <Badge>
                        <TrendingUp size={12} />
                        {fmt(farmHistory[farmHistory.length - 1].weight - farmHistory[0].weight)} kg desde {dateLabel(farmHistory[0].date)}
                      </Badge>
                    )}
                  </div>
                  <WeightChart points={farmHistory} />
                  <div className="chart-footer">
                    <span>
                      <i />
                      Peso promedio del campo
                    </span>
                    <span>{lastWeighing ? `Última pesada: ${dateLabel(lastWeighing, true)}` : "Sin pesadas"}</span>
                  </div>
                </Panel>
                <Panel title="Así se compone tu campo" subtitle="Distribución por lote" action={<Beef className="muted" size={19} />}>
                  <Composition lots={activeLots.filter((l) => l.count > 0)} />
                  <div className="composition-footer">
                    <span>En {activeLots.length} lotes activos</span>
                    <button className="text-link" onClick={() => go("animals")}>
                      Ver animales
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </Panel>
              </div>
              <div className="bottom-grid">
                <Panel
                  title="Tus lotes activos"
                  subtitle="Seguí de cerca lo que está pasando en cada lote."
                  action={
                    <button className="text-link" onClick={() => go("lots")}>
                      Ver todos
                      <ArrowRight size={15} />
                    </button>
                  }
                >
                  <DataTable
                    headers={["Lote / categoría", "Animales", "Peso prom.", "GDP", "Última pesada", ""]}
                    rows={activeLots.map((l) => {
                      const stale = l.lastWeighingDate ? daysSince(l.lastWeighingDate, s.today) > s.farm.alertConfig.staleDays : l.count > 0;
                      return [
                        <button
                          className="lot-cell"
                          key={l.id}
                          onClick={() => {
                            go("lots");
                            setSelected(l.id);
                          }}
                        >
                          <span className="lot-symbol" style={{ color: l.color, background: l.color + "14" }}>
                            <Layers size={17} />
                          </span>
                          <span>
                            <strong>{l.name}</strong>
                            <small>{l.categoryLabel}</small>
                          </span>
                        </button>,
                        fmt(l.count),
                        <strong key="w">
                          {l.weight !== null ? fmt(l.weight) : "–"} <span className="muted">kg</span>
                        </strong>,
                        <span key="g" className="gain">
                          {l.gain !== null ? `↗ ${fmt(l.gain, 2)}` : "–"}
                        </span>,
                        <span key="d" className={stale ? "warning-text" : ""}>
                          {l.lastWeighingDate ? dateLabel(l.lastWeighingDate) : "Sin pesar"}
                          {stale && <Clock3 size={13} />}
                        </span>,
                        <button
                          key="b"
                          className="icon-btn"
                          aria-label={`Ver ${l.name}`}
                          onClick={() => {
                            go("lots");
                            setSelected(l.id);
                          }}
                        >
                          <ChevronRight size={17} />
                        </button>,
                      ];
                    })}
                  />
                  <div className="table-footer">
                    <span>{count} animales en total</span>
                    <span>GDP: ganancia diaria de peso (kg/día)</span>
                  </div>
                </Panel>
                <FarmAlerts snapshot={s} onAction={setAction} onNavigate={go} onSelect={setSelected} canMoney={perms.canMoney} />
              </div>
              {perms.canWrite && (
                <div className="quick-bar">
                  <div>
                    <span className="quick-icon">
                      <Sprout size={20} />
                    </span>
                    <span>
                      <strong>Menos carga. Más campo.</strong>
                      <small>Mantené tus registros al día, estés donde estés.</small>
                    </span>
                  </div>
                  <div>
                    <button onClick={() => setAction({ type: "import" })}>
                      <Upload size={16} />
                      Importar pesada
                    </button>
                    <button onClick={() => setAction({ type: "expense" })}>
                      <Receipt size={16} />
                      Cargar gasto
                    </button>
                    <button onClick={() => setAction({ type: "health" })}>
                      <HeartPulse size={16} />
                      Registrar sanidad
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Hecho para los que viven el campo.</span>
            <span>
              <span className="live-dot" />
              {online ? "Demo · datos de ejemplo guardados en este navegador" : "Sin conexión · datos de la última sincronización"}
            </span>
          </footer>
        </main>
      </div>
      <Suspense fallback={null}>
        {action && (s || action.type === "farm") && (
          <ActionDialog
            action={action}
            snapshot={
              s || {
                farm: { id: "", name: "", location: "", hectares: 0, currency: "USD", weightUnit: "kg", timezone: "America/Montevideo", allocationMethod: "head_days", withdrawalPolicy: "block", alertConfig: { staleDays: 30, withdrawalSoonDays: 7, email: false }, createdAt: "" },
                role: "owner",
                today: new Date().toISOString().slice(0, 10),
                lots: [],
                animals: [],
                sessions: [],
                expenses: [],
                health: [],
                movements: [],
                reminders: [],
                prices: {},
                alerts: [],
                pendingImports: [],
                paddocks: [],
                owners: [],
                totals: { activeHeads: 0, totalWeight: 0, avgGdp: null, expensesAllTime: null, activeLots: 0, pregnant: 0, inService: 0, pledged: 0, sick: 0 },
              }
            }
            farms={farms}
            online={online}
            onClose={() => setAction(null)}
            onSaved={onSaved}
            onNewFarm={async (f) => {
              const next = await loadSession();
              if (next) changeFarm(f.id);
              toast.success("Campo creado");
            }}
          />
        )}
      </Suspense>
      <Toaster position="bottom-right" richColors theme="light" />
      <DemoPanel userId={session.user.id} role={role} perms={perms} onNavigate={go} onAction={setAction} />
      {farm && (
        <nav className="mobile-nav">
          <button className={page === "dashboard" ? "active" : ""} onClick={() => go("dashboard")}>
            <LayoutDashboard size={20} />
            Resumen
          </button>
          <button className={page === "lots" ? "active" : ""} onClick={() => go("lots")}>
            <Layers size={20} />
            Lotes
          </button>
          {perms.canWrite ? (
            <button className="mobile-add" onClick={() => setAction({ type: "manual" })} aria-label="Registrar pesada rápida">
              <Plus size={25} />
            </button>
          ) : (
            <span />
          )}
          <button className={page === "animals" ? "active" : ""} onClick={() => go("animals")}>
            <Beef size={20} />
            Animales
          </button>
          {perms.canWrite ? (
            <button onClick={() => setAction({ type: "expense" })}>
              <Receipt size={20} />
              Gasto
            </button>
          ) : (
            <button className={page === "alerts" ? "active" : ""} onClick={() => go("alerts")}>
              <Bell size={20} />
              Alertas
            </button>
          )}
        </nav>
      )}
    </>
  );
}

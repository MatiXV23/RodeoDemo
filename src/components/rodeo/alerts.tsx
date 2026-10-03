import { ArrowRight, Clock3, ShieldCheck, Target, CheckCircle2, Upload, CalendarClock, Baby, HeartHandshake } from "lucide-react";
import type { FarmSnapshot } from "@rodeo/shared";
import type { Action } from "./views";
import { Panel } from "./ui";

const icons = {
  sin_pesar: Clock3,
  peso_objetivo: Target,
  retiro_por_vencer: ShieldCheck,
  retiro_vigente: ShieldCheck,
  importacion_pendiente: Upload,
  recordatorio: CalendarClock,
  parto_proximo: Baby,
  entore_sin_diagnostico: HeartHandshake,
};

const tones: Record<string, string> = { warning: "amber", info: "blue", success: "green" };

export function FarmAlerts({
  snapshot,
  onAction,
  onNavigate,
  onSelect,
  canMoney,
  limit = 4,
}: {
  snapshot: FarmSnapshot;
  onAction: (a: Action) => void;
  onNavigate: (p: string) => void;
  onSelect: (id: string | null) => void;
  canMoney: boolean;
  limit?: number;
}) {
  const alerts = snapshot.alerts;
  const act = (a: FarmSnapshot["alerts"][number]) => {
    switch (a.type) {
      case "sin_pesar":
        return { label: "Registrar pesada", run: () => onAction({ type: "manual", lot: a.lotId || undefined }) };
      case "peso_objetivo":
        return { label: canMoney ? "Analizar venta" : "Ver lote", run: () => (canMoney ? onNavigate("analytics") : (onNavigate("lots"), onSelect(a.lotId || null))) };
      case "importacion_pendiente":
        return { label: "Retomar importación", run: () => onAction({ type: "import", record: a.entityId || undefined }) };
      case "recordatorio":
        return { label: "Ver sanidad", run: () => onNavigate("health") };
      case "parto_proximo":
        return { label: "Registrar nacimiento", run: () => onAction({ type: "birth", lot: a.lotId || undefined, animal: a.animalId || undefined }) };
      case "entore_sin_diagnostico":
        return { label: "Registrar diagnóstico", run: () => onAction({ type: "repro", animal: a.animalId || undefined }) };
      default:
        return { label: "Ver evento sanitario", run: () => onNavigate("health") };
    }
  };
  return (
    <Panel title="Para tener en cuenta" className="alerts" action={<span className="alert-count">{alerts.length}</span>}>
      <div id="alerts" />
      {alerts.length ? (
        alerts.slice(0, limit).map((a) => {
          const Icon = icons[a.type] || ShieldCheck;
          const { label, run } = act(a);
          return (
            <button className="alert-item" key={a.id} onClick={run}>
              <span className={`alert-icon ${tones[a.severity] || "blue"}`}>
                <Icon size={17} />
              </span>
              <span>
                <strong>{a.title}</strong>
                <p>{a.description}</p>
                <small>
                  {label}
                  <ArrowRight size={13} />
                </small>
              </span>
            </button>
          );
        })
      ) : (
        <div className="panel-padding">
          <CheckCircle2 className="gain" size={25} />
          <p className="form-note">Todo al día. No hay alertas pendientes para este campo.</p>
        </div>
      )}
      {alerts.length > limit && (
        <div className="panel-padding">
          <button className="text-link" onClick={() => onNavigate("alerts")}>
            Ver las {alerts.length} alertas
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </Panel>
  );
}

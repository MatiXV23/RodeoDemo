// Botón flotante de la demo: rol actual, cambio rápido de usuario, reinicio de
// datos, errores simulados, modo sin conexión y una guía de cosas para probar.

import { useEffect, useRef, useState } from "react";
import { FlaskConical, ChevronUp, RotateCcw, CloudOff, Bug, Mail, ListChecks, Check, ArrowRight, X } from "lucide-react";
import { ROLE_LABELS } from "@rodeo/shared";
import type { Action, Perms } from "@/components/rodeo/views";
import { db } from "@/mocks/db";
import { useSettings, setSettings, setSimulatedOffline } from "./settings";
import { demoUsers, switchUser, resetDemo, CHECKLIST_KEY } from "./actions";
import { openOutbox } from "./DemoLayer";

type Item = { id: string; title: string; hint: string; when?: (p: Perms) => boolean; cta?: { label: string; page?: string; action?: Action; offline?: boolean } };

const ITEMS: Item[] = [
  { id: "import", title: "Importá una pesada del lector", hint: "Usá «Probar con el archivo de ejemplo»: trae caravanas nuevas, una repetida, un sexo distinto y un salto de peso para resolver.", when: (p) => p.canWrite, cta: { label: "Importar", action: { type: "import" } } },
  { id: "lot", title: "Abrí un lote y mirá su proyección", hint: "Evolución del peso, días hasta el objetivo, costos acumulados y margen estimado.", cta: { label: "Ver lotes", page: "lots" } },
  { id: "sale-sim", title: "Simulá cuándo conviene vender", hint: "Mové la fecha de venta y mirá cómo cambia el margen, con sensibilidad al precio.", when: (p) => p.canMoney, cta: { label: "Análisis", page: "analytics" } },
  { id: "sale", title: "Registrá una venta", hint: "La vista previa calcula el resultado. Probá con los terneros: tienen retiro sanitario y la venta queda bloqueada.", when: (p) => p.canMoney && p.canWrite, cta: { label: "Vender", action: { type: "sale" } } },
  { id: "animals", title: "Filtrá preñadas o prendados al banco", hint: "En Animales, el filtro «Situación» separa preñadas, entore, prenda bancaria y enfermedades. Exportá la lista a Excel.", cta: { label: "Animales", page: "animals" } },
  { id: "repro", title: "Revisá el rodeo de cría", hint: "La vaca 302 está por parir: registrá el nacimiento indicando la madre y mirá cómo queda su historia.", when: (p) => p.canWrite, cta: { label: "Nacimiento", action: { type: "birth" } } },
  { id: "offline", title: "Cargá una pesada sin conexión", hint: "Activá «Sin conexión», registrá un peso (por ejemplo la caravana 858000058652944) y volvé a conectarte: se sincroniza solo.", when: (p) => p.canWrite, cta: { label: "Probar", action: { type: "manual" }, offline: true } },
  { id: "team", title: "Invitá a alguien a tu equipo", hint: "La invitación genera un correo simulado con el enlace para aceptarla.", when: (p) => p.canManage, cta: { label: "Equipo", page: "settings" } },
  { id: "report", title: "Mirá el informe del lote cerrado", hint: "«Novillos otoño» se vendió y se cerró con su resultado final: abrí el lote y tocá «Informe».", when: (p) => p.canMoney, cta: { label: "Lotes", page: "lots" } },
  { id: "roles", title: "Cambiá de rol", hint: "Entrá como Operario: carga datos pero no ve montos ni análisis. El Lector solo consulta.", },
];

function readChecked(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "[]");
  } catch {
    return [];
  }
}

export function DemoPanel({ userId, role, perms, onNavigate, onAction }: { userId: string; role: string; perms: Perms; onNavigate: (page: string) => void; onAction: (a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>(readChecked);
  const settings = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const items = ITEMS.filter((i) => !i.when || i.when(perms));
  const done = items.filter((i) => checked.includes(i.id)).length;
  const mails = db.mailOutbox.length;

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-radix-popper-content-wrapper],[role=dialog]")) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", click);
    };
  }, [open]);

  function toggle(id: string, value?: boolean) {
    setChecked((c) => {
      const next = (value ?? !c.includes(id)) ? [...new Set([...c, id])] : c.filter((x) => x !== id);
      try {
        localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });
  }

  function run(item: Item) {
    const cta = item.cta!;
    toggle(item.id, true);
    setOpen(false);
    if (cta.offline) setSimulatedOffline(true);
    if (cta.page) onNavigate(cta.page);
    if (cta.action) onAction(cta.action);
  }

  return (
    <div className="demo-fab-wrap" ref={ref}>
      {open && (
        <div className="demo-panel" role="dialog" aria-label="Panel de demo">
          <div className="demo-panel-head">
            <span className="demo-pill">DEMO</span>
            <div>
              <strong>Panel de la demo</strong>
              <small>Datos de ejemplo, guardados solo en este navegador.</small>
            </div>
            <button className="icon-btn" aria-label="Cerrar panel" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="demo-section">
            <span className="demo-label">Estás usando la app como</span>
            <div className="demo-users">
              {demoUsers.map((u) => (
                <button key={u.id} className={`demo-user ${u.id === userId ? "active" : ""}`} onClick={() => u.id !== userId && switchUser(u.id)} title={u.can} aria-pressed={u.id === userId}>
                  <span className="avatar">{u.avatar}</span>
                  <span>
                    <strong>{u.name.split(" ")[0]}</strong>
                    <small>{ROLE_LABELS[u.role]}</small>
                  </span>
                </button>
              ))}
            </div>
            <p className="demo-help">
              Rol actual en este campo: <strong>{ROLE_LABELS[role] || role}</strong>. {demoUsers.find((u) => u.id === userId)?.can || "Usuario creado en la demo."}
            </p>
          </div>

          <div className="demo-section demo-toggles">
            <label className="demo-toggle">
              <span>
                <Bug size={16} />
                Errores simulados
                <small>Algunas llamadas fallan para ver cómo responde la app.</small>
              </span>
              <input type="checkbox" role="switch" checked={settings.errors} onChange={(e) => setSettings({ errors: e.target.checked })} />
            </label>
            {settings.errors && (
              <div className="demo-rate">
                {[0.05, 0.15, 0.3, 0.5].map((r) => (
                  <button key={r} className={settings.errorRate === r ? "active" : ""} onClick={() => setSettings({ errorRate: r })}>
                    {Math.round(r * 100)}%
                  </button>
                ))}
              </div>
            )}
            <label className="demo-toggle">
              <span>
                <CloudOff size={16} />
                Sin conexión
                <small>Pesadas, gastos y sanidad quedan en cola y se sincronizan al volver.</small>
              </span>
              <input type="checkbox" role="switch" checked={settings.offline} onChange={(e) => setSimulatedOffline(e.target.checked)} />
            </label>
          </div>

          <div className="demo-section">
            <div className="demo-label-row">
              <span className="demo-label">
                <ListChecks size={15} /> Para probar
              </span>
              <small>
                {done} de {items.length}
              </small>
            </div>
            <ul className="demo-checklist">
              {items.map((i) => (
                <li key={i.id} className={checked.includes(i.id) ? "done" : ""}>
                  <button className="demo-check" aria-label={checked.includes(i.id) ? `Desmarcar ${i.title}` : `Marcar ${i.title}`} onClick={() => toggle(i.id)}>
                    {checked.includes(i.id) && <Check size={12} />}
                  </button>
                  <div>
                    <strong>{i.title}</strong>
                    <small>{i.hint}</small>
                  </div>
                  {i.cta && (
                    <button className="text-link" onClick={() => run(i)}>
                      {i.cta.label}
                      <ArrowRight size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="demo-panel-foot">
            <button className="btn" onClick={() => (setOpen(false), openOutbox())}>
              <Mail size={15} />
              Correos simulados{mails ? ` (${mails})` : ""}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm("¿Reiniciar la demo? Se borran todos los cambios y vuelven los datos de ejemplo.")) resetDemo();
              }}
            >
              <RotateCcw size={15} />
              Reiniciar demo
            </button>
          </div>
        </div>
      )}
      <button className={`demo-fab ${settings.offline ? "offline" : ""} ${settings.errors ? "errors" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Abrir el panel de demo">
        <FlaskConical size={17} />
        <span className="demo-fab-text">
          <strong>Demo</strong>
          <small>{ROLE_LABELS[role] || role}</small>
        </span>
        {settings.offline && <CloudOff size={15} />}
        {settings.errors && <Bug size={15} />}
        <ChevronUp size={15} className={open ? "" : "flip"} />
      </button>
    </div>
  );
}

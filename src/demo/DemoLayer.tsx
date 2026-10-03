// Capa global de la demo (montada junto a la app): muestra los correos que la
// app "envía" (simulados), la bandeja de correos y avisos propios de la demo.

import { useEffect, useRef, useState } from "react";
import { Mail, ExternalLink, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { db } from "@/mocks/db";
import { MAIL_EVENT, type DemoMail } from "@/mocks/services/mail";
import { startAcgScheduler } from "@/mocks/seed";
import { dateLabel, dateTimeLabel } from "@/lib/format";
import { openMailLink } from "./actions";

const OUTBOX_EVENT = "rodeo-demo:outbox";
export const openOutbox = () => window.dispatchEvent(new Event(OUTBOX_EVENT));

const KIND_LABEL: Record<string, string> = { invitacion: "Invitación", recuperacion: "Recuperación de contraseña", alertas: "Resumen de alertas" };

function MailCard({ mail, onOpen }: { mail: Pick<DemoMail, "to" | "subject" | "body" | "link" | "createdAt">; onOpen?: () => void }) {
  return (
    <article className="demo-mail">
      <dl>
        <div>
          <dt>Para</dt>
          <dd>{mail.to}</dd>
        </div>
        <div>
          <dt>Asunto</dt>
          <dd>{mail.subject}</dd>
        </div>
      </dl>
      <p>{mail.body}</p>
      {mail.link && (
        <button className="btn primary" onClick={onOpen}>
          <ExternalLink size={15} />
          Abrir el enlace como {mail.to}
        </button>
      )}
    </article>
  );
}

export function DemoLayer({ boot }: { boot: { reseeded: boolean; acg: { weekEnd: string; weeks: number } | null } }) {
  const [batch, setBatch] = useState<DemoMail[]>([]);
  const [outbox, setOutbox] = useState(false);
  const pending = useRef<DemoMail[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Varios correos en la misma operación (resumen a todo el equipo) se muestran juntos.
    const onMail = (e: Event) => {
      pending.current.push((e as CustomEvent<DemoMail>).detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setBatch(pending.current);
        pending.current = [];
      }, 250);
    };
    const onNotice = (e: Event) => {
      const { tone, message } = (e as CustomEvent<{ tone: string; message: string }>).detail;
      if (tone === "error") toast.error(message);
      else toast.info(message);
    };
    const onOutbox = () => setOutbox(true);
    window.addEventListener(MAIL_EVENT, onMail);
    window.addEventListener("rodeo-demo:notice", onNotice);
    window.addEventListener(OUTBOX_EVENT, onOutbox);
    const announce = (info: { weekEnd: string; weeks: number }) =>
      toast.info(`Precios ACG cargados automáticamente: semana al ${dateLabel(info.weekEnd, true)} (simulado).`, { description: "El planificador los trae los lunes desde las 22:00, sin que tengas que hacer nada." });
    const t = boot.acg ? setTimeout(() => announce(boot.acg!), 1500) : null;
    const stop = startAcgScheduler(announce);
    return () => {
      window.removeEventListener(MAIL_EVENT, onMail);
      window.removeEventListener("rodeo-demo:notice", onNotice);
      window.removeEventListener(OUTBOX_EVENT, onOutbox);
      if (t) clearTimeout(t);
      stop();
    };
  }, [boot]);

  const first = batch[0];
  return (
    <>
      <Dialog open={batch.length > 0} onOpenChange={(v) => !v && setBatch([])}>
        <DialogContent className="record-dialog demo-mail-dialog">
          <DialogHeader>
            <DialogTitle>
              <Mail size={18} /> {batch.length > 1 ? `Mail enviado a ${batch.length} personas (simulado)` : `Mail enviado a ${first?.to} (simulado)`}
            </DialogTitle>
            <DialogDescription>{first ? KIND_LABEL[first.kind] : ""} · En la app real llega a la casilla del destinatario. Acá lo ves al instante.</DialogDescription>
          </DialogHeader>
          {batch.length > 1 ? (
            <>
              <MailCard mail={{ ...first, to: batch.map((m) => m.to).join(", ") }} />
            </>
          ) : first ? (
            <MailCard mail={first} onOpen={() => first.link && openMailLink(first.link)} />
          ) : null}
          {first?.link && <p className="form-note">Al abrir el enlace se cierra tu sesión, como si lo abriera la persona que recibió el correo. Después volvés a entrar desde las tarjetas de usuarios de prueba.</p>}
          <div className="form-actions">
            <button className="btn" onClick={() => setBatch([])}>
              Cerrar
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={outbox} onOpenChange={setOutbox}>
        <DialogContent className="record-dialog demo-mail-dialog">
          <DialogHeader>
            <DialogTitle>
              <Inbox size={18} /> Correos simulados
            </DialogTitle>
            <DialogDescription>Lo que la app habría enviado por correo durante esta demo.</DialogDescription>
          </DialogHeader>
          <div className="demo-outbox">
            {db.mailOutbox.map((m) => (
              <div key={m.id}>
                <small>{dateTimeLabel(m.createdAt)}</small>
                <MailCard mail={m} onOpen={() => m.link && openMailLink(m.link)} />
              </div>
            ))}
            {!db.mailOutbox.length && <p className="form-note">Todavía no se envió ningún correo. Probá invitar a alguien desde Configuración → Usuarios y roles, o «Olvidé mi contraseña» en el login.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

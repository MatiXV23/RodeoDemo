// Tarjetas de usuarios de prueba en la pantalla de login: un clic y se entra
// con ese rol. Usan el mismo login de la app (POST /api/auth/login).

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ROLE_LABELS, type SessionUserView } from "@rodeo/shared";
import { DEMO_PASSWORD } from "@/mocks/seed/catalog";
import { demoUsers, prepareLogin } from "./actions";

export function DemoAccounts({ onEnter }: { onEnter: (user: SessionUserView) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function enter(email: string) {
    setBusy(email);
    try {
      prepareLogin(email);
      const r = await api.post<{ user: SessionUserView }>("/api/auth/login", { email, password: DEMO_PASSWORD });
      onEnter(r.user);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <section className="demo-accounts" aria-label="Usuarios de prueba">
      <div className="demo-accounts-head">
        <span className="demo-pill">DEMO</span>
        <strong>Entrá con un usuario de prueba</strong>
        <small>Cada uno tiene un rol distinto. Contraseña de todos: {DEMO_PASSWORD}</small>
      </div>
      <div className="demo-account-grid">
        {demoUsers.map((u) => (
          <article key={u.id} className={`demo-account role-${u.role}`}>
            <div className="demo-account-top">
              <span className="avatar">{u.avatar}</span>
              <span>
                <strong>{u.name}</strong>
                <small>
                  {ROLE_LABELS[u.role]} · {u.title}
                </small>
              </span>
            </div>
            <p>{u.can}</p>
            <button type="button" className="btn" onClick={() => enter(u.email)} disabled={!!busy}>
              {busy === u.email ? <Loader2 className="animate-spin" size={15} /> : null}
              Entrar como {u.name.split(" ")[0]}
              <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

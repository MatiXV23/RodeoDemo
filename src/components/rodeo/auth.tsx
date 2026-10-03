import { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Sprout, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Brand, Btn, Field } from "./ui";
import { api, ApiError } from "@/lib/api";
import type { SessionUserView } from "@rodeo/shared";
import { DemoAccounts } from "@/demo/DemoAccounts";
import { DEMO_PASSWORD } from "@/mocks/seed/catalog";

type Mode = "login" | "register" | "recover" | "reset" | "invite";

export function Auth({
  onEnter,
  onAccepted,
  resetToken,
  inviteToken,
  user,
}: {
  onEnter: (user: SessionUserView) => void;
  onAccepted?: () => void;
  resetToken?: string | null;
  inviteToken?: string | null;
  user?: SessionUserView | null;
}) {
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : inviteToken ? "invite" : "login");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ email: string; role: string; farmName: string; accepted: boolean } | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    api
      .get<{ email: string; role: string; farmName: string; accepted: boolean }>(`/api/invitations/${inviteToken}`)
      .then(setInvite)
      .catch((e: ApiError) => setError(e.message));
  }, [inviteToken]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const d = new FormData(e.currentTarget);
    const get = (k: string) => String(d.get(k) || "");
    try {
      if (mode === "login") {
        const r = await api.post<{ user: SessionUserView }>("/api/auth/login", { email: get("email"), password: get("password") });
        onEnter(r.user);
      } else if (mode === "register") {
        const r = await api.post<{ user: SessionUserView }>("/api/auth/register", { email: get("email"), password: get("password"), name: get("name") });
        onEnter(r.user);
      } else if (mode === "recover") {
        await api.post("/api/auth/forgot", { email: get("email") });
        setSent(true);
      } else if (mode === "reset") {
        if (get("password") !== get("confirm")) throw new Error("Las contraseñas no coinciden.");
        await api.post("/api/auth/reset", { token: resetToken, password: get("password") });
        const me = await api.get<{ user: SessionUserView | null }>("/api/auth/me");
        if (me.user) onEnter(me.user);
        else setMode("login");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite() {
    setError("");
    setBusy(true);
    try {
      await api.post(`/api/invitations/${inviteToken}`);
      onAccepted?.();
      const me = await api.get<{ user: SessionUserView | null }>("/api/auth/me");
      if (me.user) onEnter(me.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, [string, string]> = {
    login: ["Qué bueno verte de nuevo.", "Entrá y mirá cómo viene tu rodeo."],
    register: ["Empezá a organizar tu campo.", "Todos tus establecimientos, en un solo lugar."],
    recover: ["Recuperá tu acceso.", "Ingresá el correo asociado a tu cuenta."],
    reset: ["Elegí una nueva contraseña.", "Al menos 8 caracteres."],
    invite: ["Te invitaron a un campo.", invite ? `${invite.farmName} · rol ${invite.role}` : "Verificando la invitación..."],
  };

  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">CERCA DEL CAMPO. CERCA DE TUS DECISIONES.</span>
          <h1>
            Tu trabajo crece.
            <br />
            Tu información
            <br />
            también.
          </h1>
          <p>Una mirada clara sobre tus animales, tus lotes y el futuro de tu campo.</p>
          <div className="auth-stats">
            <span>
              <Sprout size={24} />
              Cada lote cuenta.
            </span>
            <span>
              <ShieldCheck size={24} />
              Cada dato importa.
            </span>
          </div>
        </div>
        <small>Rodeo · Gestión ganadera</small>
      </div>
      <div className="auth-form">
        <span className="auth-mobile-brand">
          <Brand />
        </span>
        <h2>{titles[mode][0]}</h2>
        <p>{titles[mode][1]}</p>
        {mode === "invite" ? (
          <div className="record-form">
            {invite?.accepted && <div className="notice">Esta invitación ya fue utilizada.</div>}
            {invite && !invite.accepted && (
              <>
                <p className="form-note">
                  La invitación es para <strong>{invite.email}</strong>.{" "}
                  {user ? (user.email === invite.email ? "Podés aceptarla con tu sesión actual." : `Estás conectado como ${user.email}; cerrá sesión e ingresá con el correo invitado.`) : "Iniciá sesión o creá tu cuenta con ese correo para aceptarla."}
                </p>
                {user && user.email === invite.email ? (
                  <Btn variant="primary" onClick={acceptInvite} disabled={busy}>
                    Aceptar invitación
                    <ArrowRight size={17} />
                  </Btn>
                ) : (
                  <div className="form-actions">
                    <Btn onClick={() => setMode("register")}>Crear cuenta</Btn>
                    <Btn variant="primary" onClick={() => setMode("login")}>
                      Iniciar sesión
                    </Btn>
                  </div>
                )}
              </>
            )}
          </div>
        ) : sent ? (
          <div className="notice">
            <ShieldCheck size={23} />
            <span>Si el correo está registrado, vas a recibir un enlace para elegir una nueva contraseña. Revisá también la carpeta de no deseados.</span>
          </div>
        ) : (
          <>
          {mode === "login" && (
            <>
              <DemoAccounts onEnter={onEnter} />
              <div className="demo-divider">o con correo y contraseña</div>
            </>
          )}
          <form onSubmit={submit}>
            {mode === "register" && (
              <Field label="Nombre completo">
                <input name="name" autoComplete="name" placeholder="Tu nombre" required />
              </Field>
            )}
            {mode !== "reset" && (
              <Field label="Correo electrónico">
                <input name="email" type="email" autoComplete="email" placeholder="nombre@campo.com" defaultValue={invite?.email || (mode === "login" ? "demo@rodeo.app" : "")} key={mode} required />
              </Field>
            )}
            {mode !== "recover" && (
              <Field label={mode === "reset" ? "Nueva contraseña" : "Contraseña"}>
                <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} placeholder="Al menos 8 caracteres" defaultValue={mode === "login" ? DEMO_PASSWORD : undefined} key={mode} required />
              </Field>
            )}
            {mode === "reset" && (
              <Field label="Repetir contraseña">
                <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
              </Field>
            )}
            {mode === "login" && (
              <button type="button" className="text-link" onClick={() => setMode("recover")}>
                Olvidé mi contraseña
              </button>
            )}
            {error && (
              <p role="alert" className="form-error">
                <AlertTriangle size={17} />
                {error}
              </p>
            )}
            <Btn type="submit" variant="primary" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" size={17} /> : null}
              {mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : mode === "reset" ? "Guardar contraseña" : "Enviar enlace de recuperación"}
              <ArrowRight size={17} />
            </Btn>
          </form>
          </>
        )}
        {error && mode === "invite" && (
          <p role="alert" className="form-error">
            <AlertTriangle size={17} />
            {error}
          </p>
        )}
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              ¿Todavía no tenés cuenta?{" "}
              <button
                onClick={() => {
                  setMode("register");
                  setSent(false);
                  setError("");
                }}
              >
                Registrate
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setMode("login");
                setSent(false);
                setError("");
              }}
            >
              <ArrowLeft size={14} />
              Volver a iniciar sesión
            </button>
          )}
        </div>
        <p className="form-note">Demo con datos de ejemplo: lo que cargues queda solo en este navegador y podés reiniciarlo cuando quieras.</p>
      </div>
    </div>
  );
}

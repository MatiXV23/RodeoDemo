// Cliente "HTTP" de la demo. Tiene exactamente la misma interfaz que el cliente
// real (api.get/post/patch/delete/upload, ApiError, farmPath, downloadFile),
// pero en lugar de llamar al servidor resuelve cada ruta con los servicios
// simulados de src/mocks. Agrega latencia de red y, si se activan desde el
// panel de demo, errores ocasionales o el modo sin conexión.

import { handle, type MockFile, type MockHtml } from "@/mocks/router";
import { getSettings, isSimulatedOffline } from "@/demo/settings";

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
  get code(): string | undefined {
    return (this.details as { code?: string } | null)?.code;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => 200 + Math.random() * 400;

// Rutas que nunca fallan a propósito: la sesión no debería "caerse" por un error simulado.
const isAuth = (path: string) => path.startsWith("/api/auth/");

/** Simula el viaje por la red y convierte los errores de los servicios en ApiError. */
async function request<T>(method: string, path: string, init: { body?: unknown; form?: FormData } = {}): Promise<T> {
  await sleep(latency());
  if (isSimulatedOffline() && !isAuth(path)) throw new TypeError("Sin conexión: no se pudo contactar al servidor (simulado).");
  const s = getSettings();
  if (s.errors && !isAuth(path) && Math.random() < s.errorRate) {
    throw new ApiError(503, "Error simulado: el servidor no respondió. Probá de nuevo (podés apagar los errores en el panel de demo).", { code: "error_simulado" });
  }
  try {
    // Como en una red real, el cuerpo viaja serializado: nadie comparte referencias con la "base".
    const body = init.body === undefined ? undefined : JSON.parse(JSON.stringify(init.body));
    const result = await handle(method, path, { body, form: init.form ?? null });
    if (result && typeof result === "object" && ("__file" in result || "__html" in result)) return result as T;
    return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
  } catch (e) {
    const err = e as { status?: number; message?: string; details?: unknown };
    const apiErr = new ApiError(err.status || 500, err.message || `Error ${err.status || 500}`, err.details);
    if (apiErr.status === 401) window.dispatchEvent(new CustomEvent("rodeo:unauthorized"));
    throw apiErr;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};

export const farmPath = (farmId: string, rest = "") => `/api/farms/${farmId}${rest}`;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Descarga un archivo (exportaciones, comprobantes): se genera en el navegador. */
export async function downloadFile(path: string, fallbackName = "archivo") {
  try {
    const file = await request<MockFile>("GET", path);
    saveBlob(new Blob([file.bytes as BlobPart], { type: file.contentType }), file.fileName || fallbackName);
  } catch (e) {
    const err = e as ApiError;
    // Los errores de descarga se muestran como aviso (la app real los descarta en silencio).
    window.dispatchEvent(new CustomEvent("rodeo-demo:notice", { detail: { tone: err.code === "archivo_simulado" ? "info" : "error", message: err.message || "No se pudo descargar el archivo." } }));
  }
}

/**
 * Abre una página generada (informe del lote) en una pestaña nueva. La pestaña se
 * abre en el mismo clic para que el navegador no la bloquee y se completa después.
 */
export async function openPage(path: string) {
  const win = window.open("", "_blank");
  win?.document.write('<p style="font-family:system-ui;color:#5b6b60;padding:24px">Generando el informe…</p>');
  try {
    const page = await request<MockHtml>("GET", path);
    if (win) {
      win.document.open();
      win.document.write(page.html);
      win.document.close();
    } else {
      saveBlob(new Blob([page.html], { type: "text/html" }), "informe.html");
    }
  } catch (e) {
    win?.close();
    window.dispatchEvent(new CustomEvent("rodeo-demo:notice", { detail: { tone: "error", message: (e as Error).message } }));
  }
}

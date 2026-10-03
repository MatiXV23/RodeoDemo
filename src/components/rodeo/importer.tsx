import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CheckCircle2, FileSpreadsheet, Upload, AlertTriangle, Download, Loader2, ArrowRight, Users, Tag, PlusCircle, Ban } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, Badge, Pick, DataTable, Field } from "./ui";
import { api, ApiError, farmPath } from "@/lib/api";
import { fmt } from "@/lib/format";
import { buildSampleWeighing, downloadSampleWeighing } from "@/demo/sample-file";
import { SEX_LABELS, type ValidatedRow, type ValidationSummary, type IssueCode, type Sex } from "@rodeo/shared";

type Preview = {
  batchId: string;
  status: string;
  sessionId: string | null;
  fileName: string;
  sessionDate: string;
  rows: ValidatedRow[];
  summary: ValidationSummary;
  lots: { id: string; name: string; category: string; status?: string }[];
  parseWarnings?: string[];
};

type Decision = { action: "include" | "discard"; lotId?: string | null; updateSex?: boolean };

// Pop-ups que se muestran al cargar el archivo, en orden: resumen → sexo distinto → animales nuevos.
type Prompt = { kind: "summary" } | { kind: "sex"; index: number } | { kind: "new"; index: number } | null;

const BLOCKING: IssueCode[] = ["caravana_invalida", "peso_invalido", "inactivo"];
const LABELS: Record<IssueCode, string> = {
  caravana_invalida: "Caravana inválida",
  peso_invalido: "Peso inválido",
  duplicado: "Repetida en el archivo",
  no_registrado: "Animal nuevo",
  inactivo: "Animal inactivo",
  fuera_de_rango: "Peso fuera de rango",
  variacion_alta: "Variación alta",
  manual: "Tipeado a mano",
  sin_fecha: "Sin fecha",
  sexo_distinto: "Sexo distinto",
};

const sexLabel = (s: string | null | undefined) => SEX_LABELS[(s || "sin_dato") as Sex] || "Sin dato";

export function Importer({
  farmId,
  batchId: initialBatch,
  onDone,
  onClose,
}: {
  farmId: string;
  batchId?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [step, setStep] = useState(initialBatch ? 1 : 0);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(!!initialBatch);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [batchLot, setBatchLot] = useState("");
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState<{ imported: number; created: number; discarded?: number; sexUpdated?: number; alreadyConfirmed: boolean } | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [promptLot, setPromptLot] = useState("");

  useEffect(() => {
    if (!initialBatch) return;
    api
      .get<Preview>(farmPath(farmId, `/imports/${initialBatch}`))
      .then((p) => {
        if (p.status !== "pendiente") {
          setError("Esta importación ya fue procesada.");
          return;
        }
        applyPreview(p);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBatch]);

  function applyPreview(p: Preview) {
    setPreview(p);
    setDate(p.sessionDate);
    setName(p.fileName.replace(/\.(xlsx|csv|txt|tsv)$/i, ""));
    setDecisions({});
    setBatchLot("");
    setPromptLot(p.lots.find((l) => !l.status || l.status === "activo")?.id || "");
    setStep(1);
    setPrompt({ kind: "summary" });
  }

  async function load(file: File) {
    setLoading(true);
    setError("");
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera los 10 MB.");
      const form = new FormData();
      form.append("file", file);
      applyPreview(await api.upload<Preview>(farmPath(farmId, "/imports"), form));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const rows = preview?.rows || [];
  const lotName = (id: string | null | undefined) => (id ? preview?.lots.find((l) => l.id === id)?.name || "Lote desconocido" : "Sin lote");
  const lotOptions = (preview?.lots || []).filter((l) => !l.status || l.status === "activo").map((l) => ({ value: l.id, label: l.name }));
  const decisionFor = (r: ValidatedRow): Decision => decisions[r.line] || { action: r.defaultAction, lotId: r.lotId ?? (r.isNew ? batchLot || null : null), updateSex: false };
  const patch = (line: number, d: Partial<Decision>, base: ValidatedRow) => setDecisions((ds) => ({ ...ds, [line]: { ...decisionFor(base), ...d } }));
  // Aplica una decisión a todas las filas de una caravana (repetidas incluidas).
  const patchEids = (eids: Set<string>, d: Partial<Decision> | ((r: ValidatedRow) => Partial<Decision>)) =>
    setDecisions((ds) => {
      const next = { ...ds };
      for (const r of rows) {
        if (!eids.has(r.eid)) continue;
        const base = next[r.line] || { action: r.defaultAction, lotId: r.lotId ?? (r.isNew ? batchLot || null : null), updateSex: false };
        next[r.line] = { ...base, ...(typeof d === "function" ? d(r) : d) };
      }
      return next;
    });

  // Una fila representativa por caravana (la que se incluye por defecto) para los pop-ups.
  const representative = (filter: (r: ValidatedRow) => boolean) => {
    const byEid = new Map<string, ValidatedRow>();
    for (const r of rows) if (filter(r) && (!byEid.has(r.eid) || !r.duplicateOf)) byEid.set(r.eid, r);
    return [...byEid.values()];
  };
  const sexRows = useMemo(() => representative((r) => r.sexConflict && !r.issues.some((i) => BLOCKING.includes(i))), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const newRows = useMemo(() => representative((r) => r.isNew && !r.issues.some((i) => BLOCKING.includes(i))), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const lotBreakdown = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const r of representative((r) => !!r.animalId && !r.issues.includes("inactivo"))) counts.set(r.lotId, (counts.get(r.lotId) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const inactiveCount = useMemo(() => representative((r) => r.issues.includes("inactivo")).length, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const sexFillCount = useMemo(() => representative((r) => r.sexFill).length, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const included = rows.filter((r) => decisionFor(r).action === "include");
  const unresolved = rows.filter((r) => {
    const d = decisionFor(r);
    if (d.action !== "include") return false;
    if (r.issues.some((i) => BLOCKING.includes(i))) return true;
    if (r.isNew && !d.lotId) return true;
    return false;
  });
  const dupIncludedTwice = useMemo(() => {
    const seen = new Map<string, number>();
    let count = 0;
    for (const r of included) {
      if (seen.has(r.eid)) count++;
      seen.set(r.eid, r.line);
    }
    return count;
  }, [included]);
  const sexChanges = included.filter((r) => r.sexFill || (r.sexConflict && decisionFor(r).updateSex)).length;
  const ready = !!preview && included.length > 0 && unresolved.length === 0 && dupIncludedTwice === 0 && !!date && (!preview.summary.alreadyImported || ack);
  const visibleRows = onlyIssues ? rows.filter((r) => r.issues.length) : rows;

  // Navegación entre pop-ups: después del resumen van los conflictos de sexo y luego los nuevos.
  function nextPrompt(from: Prompt) {
    if (!from) return setPrompt(null);
    if (from.kind === "summary") return setPrompt(sexRows.length ? { kind: "sex", index: 0 } : newRows.length ? { kind: "new", index: 0 } : null);
    if (from.kind === "sex") return setPrompt(from.index + 1 < sexRows.length ? { kind: "sex", index: from.index + 1 } : newRows.length ? { kind: "new", index: 0 } : null);
    return setPrompt(from.index + 1 < newRows.length ? { kind: "new", index: from.index + 1 } : null);
  }
  function decideSex(from: { kind: "sex"; index: number }, updateSex: boolean, all: boolean) {
    const targets = all ? sexRows.slice(from.index) : [sexRows[from.index]];
    patchEids(new Set(targets.map((r) => r.eid)), { updateSex });
    if (all) return setPrompt(newRows.length ? { kind: "new", index: 0 } : null);
    nextPrompt(from);
  }
  function decideNew(from: { kind: "new"; index: number }, add: boolean, all: boolean) {
    const targets = all ? newRows.slice(from.index) : [newRows[from.index]];
    const lotId = add ? promptLot || null : null;
    patchEids(new Set(targets.map((r) => r.eid)), (r) => (add ? { action: r.duplicateOf || r.issues.some((i) => BLOCKING.includes(i)) ? "discard" : "include", lotId } : { action: "discard" }));
    if (add && all && lotId) setBatchLot(lotId);
    if (all) return setPrompt(null);
    nextPrompt(from);
  }

  async function confirm() {
    if (!preview || !ready) return;
    setLoading(true);
    setError("");
    setErrors([]);
    try {
      const r = await api.post<{ sessionId: string; imported: number; created: number; discarded?: number; sexUpdated?: number; alreadyConfirmed: boolean }>(farmPath(farmId, `/imports/${preview.batchId}/confirm`), {
        date,
        name,
        defaultLotId: batchLot || null,
        acknowledgeDuplicateImport: ack,
        decisions: rows.map((row) => {
          const d = decisionFor(row);
          return { line: row.line, action: d.action, lotId: d.lotId || null, updateSex: !!d.updateSex };
        }),
      });
      setResult(r);
      setStep(3);
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      const details = err.details as { errors?: string[] } | null;
      if (details?.errors) setErrors(details.errors);
    } finally {
      setLoading(false);
    }
  }

  async function discard() {
    if (!preview) return onClose();
    try {
      await api.delete(farmPath(farmId, `/imports/${preview.batchId}`));
    } catch {
      /* si falla, queda pendiente y aparece como alerta */
    }
    onDone();
    onClose();
  }

  const tone = (r: ValidatedRow, d: Decision) => (d.action === "discard" ? "gray" : r.issues.some((i) => BLOCKING.includes(i)) ? "red" : r.issues.length ? "amber" : "green");

  return (
    <div className="import-flow">
      <div className="import-steps">
        {["Subir archivo", "Revisar datos", "Confirmar"].map((s, i) => (
          <span key={s} className={step >= i ? "active" : ""}>
            <b>{step > i ? <Check size={13} /> : i + 1}</b>
            {s}
          </span>
        ))}
      </div>
      {step === 0 ? (
        <>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
            }}
          >
            <input
              type="file"
              accept=".xlsx,.csv,.txt,.tsv"
              onChange={(e) => {
                if (e.target.files?.[0]) load(e.target.files[0]);
              }}
              aria-label="Subir archivo del lector"
            />
            {loading ? <Loader2 className="animate-spin" size={36} /> : <Upload size={36} />}
            <strong>{loading ? "Leyendo archivo..." : "Arrastrá el archivo del lector"}</strong>
            <span>o tocá para elegir un archivo</span>
            <small>Excel del lector (.xlsx) o CSV · Hasta 10 MB · El archivo original queda guardado con la sesión</small>
          </label>
          <div className="import-help">
            <FileSpreadsheet size={19} />
            <p>
              Se toma la primera hoja. Columnas: <strong>IDE</strong> (caravana de 15 dígitos), <strong>Peso (kg)</strong>, y opcionales Fecha, Modo, Observación y Sexo (0 = sin dato, 1 o M = macho, 2 o H = hembra). El orden y los acentos no importan. Cada caravana se vincula con el animal ya cargado en este campo; las que no existan se pueden dar de alta en un lote.
            </p>
          </div>
          <div className="detail-actions">
            <button type="button" className="btn primary" onClick={() => {
              const sample = buildSampleWeighing(farmId);
              load(new File([sample.bytes as BlobPart], sample.fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            }}>
              <FileSpreadsheet size={16} />
              Probar con el archivo de ejemplo
            </button>
            <button type="button" className="btn" onClick={() => downloadSampleWeighing(farmId)}>
              <Download size={16} />
              Descargar archivo de ejemplo del lector
            </button>
          </div>
        </>
      ) : step === 1 ? (
        !preview ? (
          <div className="loading-view" role="status">
            {loading ? "Recuperando la importación..." : error || "No se pudo cargar la importación."}
          </div>
        ) : (
          <>
            <div className="import-file">
              <FileSpreadsheet size={22} />
              <div>
                <strong>{preview.fileName}</strong>
                <span>
                  {preview.summary.total} filas · {preview.summary.withIssues} con observaciones · {preview.summary.newAnimals} animales nuevos
                  {preview.summary.duplicates ? ` · ${preview.summary.duplicates} repetidas` : ""}
                  {preview.summary.sexConflicts ? ` · ${preview.summary.sexConflicts} con sexo distinto` : ""}
                </span>
              </div>
              <button className="text-link" onClick={() => setStep(0)}>
                Cambiar archivo
              </button>
            </div>
            <Progress value={100} />
            {preview.parseWarnings?.map((w) => (
              <div className="notice subtle" key={w}>
                {w}
              </div>
            ))}
            {preview.summary.alreadyImported && (
              <label className="check-label warning-text">
                <Checkbox checked={ack} onCheckedChange={(v) => setAck(!!v)} />
                {preview.summary.warnings.join(" ")} Confirmo que quiero registrarlo de nuevo.
              </label>
            )}
            <div className="form-grid">
              <Field label="Fecha de la sesión">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Nombre de la sesión">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Control de terminación" />
              </Field>
              {preview.summary.newAnimals > 0 && (
                <Field label="Lote para los animales nuevos">
                  <Pick
                    label="Lote para animales nuevos"
                    value={batchLot}
                    onChange={(v) => {
                      setBatchLot(v);
                      setDecisions((ds) => {
                        const next = { ...ds };
                        for (const r of rows) if (r.isNew) next[r.line] = { ...(next[r.line] || { action: r.defaultAction }), lotId: v };
                        return next;
                      });
                    }}
                    options={lotOptions}
                  />
                </Field>
              )}
            </div>
            {preview.summary.newAnimals > 0 && !lotOptions.length && (
              <div className="notice amber">
                <AlertTriangle size={18} />
                Hay caravanas no registradas y el campo no tiene lotes activos. Creá un lote antes de confirmar.
              </div>
            )}
            <div className="animal-picker-heading">
              <strong>Filas del archivo</strong>
              <label className="check-label">
                <Checkbox checked={onlyIssues} onCheckedChange={(v) => setOnlyIssues(!!v)} />
                Ver solo filas con observaciones
              </label>
            </div>
            <div className="import-table">
              <DataTable
                headers={["Incluir", "Caravana / fila", "Peso (kg)", "Validación", "Resolver"]}
                rows={visibleRows.map((r) => {
                  const d = decisionFor(r);
                  const blocking = r.issues.some((i) => BLOCKING.includes(i));
                  return [
                    <Checkbox key="c" aria-label={`Incluir fila ${r.line}`} checked={d.action === "include"} disabled={blocking} onCheckedChange={(v) => patch(r.line, { action: v ? "include" : "discard" }, r)} />,
                    <div key="id" className={d.action === "discard" ? "discarded" : ""}>
                      <span className="animal-id">{r.eid || "—"}</span>
                      <small className="block muted">
                        Fila {r.line}
                        {r.animalId ? ` · ${lotName(r.lotId)}` : ""}
                        {r.date ? ` · ${r.date}${r.time ? " " + r.time.slice(0, 5) : ""}` : ""}
                        {r.observation ? ` · ${r.observation}` : ""}
                      </small>
                    </div>,
                    <span key="w">
                      {r.weight ? fmt(Number(r.weight), 1) : "—"}
                      {r.previousWeight && <small className="block muted">antes {fmt(Number(r.previousWeight), 0)} kg</small>}
                    </span>,
                    <div key="s" className="issue-list">
                      <Badge tone={tone(r, d)}>{d.action === "discard" ? "Descartada" : r.issues.length ? r.issues.map((i) => LABELS[i]).join(" · ") : "Correcta"}</Badge>
                      {r.messages.length > 0 && d.action !== "discard" && <small className="block muted">{r.messages.join(" ")}</small>}
                    </div>,
                    blocking ? (
                      <span key="b" className="muted">
                        Se descarta
                      </span>
                    ) : r.duplicateOf && d.action === "discard" ? (
                      <button key="d" className="text-link" onClick={() => patch(r.line, { action: "include" }, r)}>
                        Conservar esta fila
                      </button>
                    ) : r.isNew ? (
                      <Pick key="l" label={`Lote de fila ${r.line}`} value={d.lotId || ""} onChange={(v) => patch(r.line, { lotId: v }, r)} options={lotOptions} />
                    ) : r.sexConflict ? (
                      <Pick
                        key="x"
                        label={`Sexo de fila ${r.line}`}
                        value={d.updateSex ? "apply" : "keep"}
                        onChange={(v) => patchEids(new Set([r.eid]), { updateSex: v === "apply" })}
                        options={[
                          { value: "keep", label: `Mantener ${sexLabel(r.currentSex).toLowerCase()}` },
                          { value: "apply", label: `Cambiar a ${sexLabel(r.fileSex).toLowerCase()}` },
                        ]}
                      />
                    ) : (
                      <Check key="ok" size={17} className="gain" />
                    ),
                  ];
                })}
              />
            </div>
            <div className="form-actions">
              <span className="muted">
                {included.length} filas a importar · {unresolved.length} por resolver
                {dupIncludedTwice ? ` · ${dupIncludedTwice} caravanas incluidas dos veces` : ""}
                {sexChanges ? ` · ${sexChanges} cambios de sexo` : ""}
              </span>
              <Btn onClick={discard}>Descartar importación</Btn>
              <Btn variant="primary" disabled={!ready} onClick={() => setStep(2)}>
                Revisar resumen
                <ArrowRight size={16} />
              </Btn>
            </div>

            {/* Pop-ups de carga: resumen del archivo, conflictos de sexo y animales nuevos. */}
            {prompt?.kind === "summary" && (
              <ImportPrompt title="Resumen del archivo" description={`${preview.fileName} · ${preview.summary.total} filas`} onSkip={() => setPrompt(null)}>
                <ul className="import-breakdown">
                  {lotBreakdown.map(([lotId, count]) => (
                    <li key={lotId || "none"}>
                      <Users size={16} />
                      <span>
                        <strong>{lotName(lotId)}</strong> · {count} {count === 1 ? "animal" : "animales"} ya cargados
                      </span>
                    </li>
                  ))}
                  {newRows.length > 0 && (
                    <li className="amber">
                      <PlusCircle size={16} />
                      <span>
                        <strong>{newRows.length} {newRows.length === 1 ? "caravana nueva" : "caravanas nuevas"}</strong> que no están registradas en el campo
                      </span>
                    </li>
                  )}
                  {sexRows.length > 0 && (
                    <li className="amber">
                      <Tag size={16} />
                      <span>
                        <strong>{sexRows.length} {sexRows.length === 1 ? "animal" : "animales"} con sexo distinto</strong> al que estaba registrado
                      </span>
                    </li>
                  )}
                  {sexFillCount > 0 && (
                    <li>
                      <Tag size={16} />
                      <span>
                        {sexFillCount} {sexFillCount === 1 ? "animal sin sexo cargado lo tomará" : "animales sin sexo cargado lo tomarán"} del lector
                      </span>
                    </li>
                  )}
                  {inactiveCount > 0 && (
                    <li className="red">
                      <Ban size={16} />
                      <span>
                        {inactiveCount} {inactiveCount === 1 ? "animal inactivo" : "animales inactivos"} (vendidos o muertos): se descartan
                      </span>
                    </li>
                  )}
                  {!lotBreakdown.length && !newRows.length && (
                    <li>
                      <AlertTriangle size={16} />
                      <span>Ninguna caravana del archivo coincide con animales activos del campo.</span>
                    </li>
                  )}
                </ul>
                <div className="prompt-actions">
                  <Btn variant="primary" onClick={() => nextPrompt({ kind: "summary" })}>
                    {sexRows.length || newRows.length ? "Continuar" : "Revisar filas"}
                    <ArrowRight size={16} />
                  </Btn>
                </div>
              </ImportPrompt>
            )}
            {prompt?.kind === "sex" && sexRows[prompt.index] && (
              <ImportPrompt
                title="Sexo distinto al registrado"
                description={`Conflicto ${prompt.index + 1} de ${sexRows.length}`}
                onSkip={() => nextPrompt({ kind: "sex", index: sexRows.length - 1 })}
              >
                {(() => {
                  const r = sexRows[prompt.index];
                  const remaining = sexRows.length - prompt.index;
                  return (
                    <>
                      <p className="prompt-text">
                        La caravana <span className="animal-id">{r.eid}</span> ({lotName(r.lotId)}) antes estaba marcada como <strong>{sexLabel(r.currentSex).toLowerCase()}</strong> y el lector la leyó como <strong>{sexLabel(r.fileSex).toLowerCase()}</strong>. ¿Querés cambiarla?
                      </p>
                      <div className="prompt-actions">
                        <Btn onClick={() => decideSex(prompt, false, false)}>Mantener {sexLabel(r.currentSex).toLowerCase()}</Btn>
                        <Btn variant="primary" onClick={() => decideSex(prompt, true, false)}>
                          Aplicar: cambiar a {sexLabel(r.fileSex).toLowerCase()}
                        </Btn>
                        {remaining > 1 && (
                          <Btn variant="primary" onClick={() => decideSex(prompt, true, true)}>
                            Aplicar a todos los siguientes ({remaining})
                          </Btn>
                        )}
                      </div>
                      {remaining > 1 && (
                        <button className="text-link" onClick={() => decideSex(prompt, false, true)}>
                          Mantener el sexo registrado en todos los siguientes ({remaining})
                        </button>
                      )}
                    </>
                  );
                })()}
              </ImportPrompt>
            )}
            {prompt?.kind === "new" && newRows[prompt.index] && (
              <ImportPrompt title="Animal nuevo" description={`Caravana nueva ${prompt.index + 1} de ${newRows.length}`} onSkip={() => setPrompt(null)}>
                {(() => {
                  const r = newRows[prompt.index];
                  const remaining = newRows.length - prompt.index;
                  return (
                    <>
                      <p className="prompt-text">
                        La caravana <span className="animal-id">{r.eid}</span> ({r.weight ? `${fmt(Number(r.weight), 0)} kg` : "sin peso"}
                        {r.observation ? ` · ${r.observation}` : ""}) no está registrada en este campo. ¿Querés agregarla a un lote?
                      </p>
                      {lotOptions.length ? (
                        <Field label="Lote">
                          <Pick label="Lote para el animal nuevo" value={promptLot} onChange={setPromptLot} options={lotOptions} />
                        </Field>
                      ) : (
                        <div className="notice amber">
                          <AlertTriangle size={18} />
                          El campo no tiene lotes activos. Creá un lote y volvé a esta importación desde Pesadas.
                        </div>
                      )}
                      <div className="prompt-actions">
                        <Btn onClick={() => decideNew(prompt, false, false)}>Omitir</Btn>
                        <Btn variant="primary" disabled={!promptLot} onClick={() => decideNew(prompt, true, false)}>
                          Aplicar: agregar al lote
                        </Btn>
                        {remaining > 1 && (
                          <Btn variant="primary" disabled={!promptLot} onClick={() => decideNew(prompt, true, true)}>
                            Aplicar a todos los siguientes ({remaining})
                          </Btn>
                        )}
                      </div>
                      {remaining > 1 && (
                        <button className="text-link" onClick={() => decideNew(prompt, false, true)}>
                          Omitir todos los siguientes ({remaining})
                        </button>
                      )}
                    </>
                  );
                })()}
              </ImportPrompt>
            )}
          </>
        )
      ) : step === 2 && preview ? (
        <>
          <div className="import-summary">
            <CheckCircle2 size={42} />
            <h3>Todo listo para registrar</h3>
            <p>
              {included.length} pesos · {rows.length - included.length} filas descartadas
            </p>
            <strong>{fmt(included.reduce((s, r) => s + Number(r.weight || 0), 0))} kg en total</strong>
            <p>{included.filter((r) => r.isNew).length} animales nuevos se crearán en los lotes seleccionados.</p>
            {sexChanges > 0 && <p>{sexChanges} animales quedarán con el sexo leído por el lector.</p>}
            <Badge tone="gray">
              {name || preview.fileName} · {date}
            </Badge>
          </div>
          {errors.length > 0 && (
            <ul className="form-error">
              {errors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <Btn onClick={() => setStep(1)}>Volver a revisar</Btn>
            <Btn variant="primary" onClick={confirm} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" size={16} /> : null}
              Confirmar pesada
            </Btn>
          </div>
        </>
      ) : (
        <div className="import-summary">
          <CheckCircle2 size={48} />
          <h3>{result?.alreadyConfirmed ? "Esta importación ya estaba registrada" : "Pesada registrada"}</h3>
          <p>
            {result?.imported ?? 0} pesos guardados · {result?.created ?? 0} animales nuevos
            {result?.sexUpdated ? ` · ${result.sexUpdated} sexos actualizados` : ""}
          </p>
          <Btn variant="primary" onClick={onClose}>
            Volver a pesadas
          </Btn>
        </div>
      )}
      {error && step !== 2 && (
        <p role="alert" className="form-error">
          <AlertTriangle size={17} />
          {error}
        </p>
      )}
    </div>
  );
}

/** Pop-up sobre el importador. Cerrarlo (Esc o clic afuera) salta las preguntas y deja las decisiones por defecto. */
function ImportPrompt({ title, description, onSkip, children }: { title: string; description: string; onSkip: () => void; children: ReactNode }) {
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onSkip();
      }}
    >
      <DialogContent className="record-dialog import-prompt" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

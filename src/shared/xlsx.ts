import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

// Lector/escritor mínimo de .xlsx (Office Open XML) sin dependencias nativas ni
// filesystem, para que funcione igual en Workers, en el navegador y en Node.
// Cubre lo que necesita la app: primera hoja, strings compartidos e inline,
// números, booleanos y fechas seriales; y escritura de hojas con strings inline.

export type CellValue = string | number | boolean | Date | null;

export type Sheet = {
  name: string;
  rows: CellValue[][];
};

const entities: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXml(text: string) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => entities[m] ?? m);
}

function encodeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caracteres de control no permitidos en XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

function columnIndex(ref: string) {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index: number) {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Convierte un serial de fecha de Excel (sistema 1900) a Date UTC.
export function excelSerialToDate(serial: number) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function readDateStyles(files: Record<string, Uint8Array>) {
  const styles = files["xl/styles.xml"];
  if (!styles) return new Set<number>();
  const xml = strFromU8(styles);
  const custom = new Set<number>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const id = Number(attr(m[1], "numFmtId"));
    const code = (attr(m[1], "formatCode") || "").replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
    if (/[dmyhs]/i.test(code) && !/[#0]/.test(code)) custom.add(id);
  }
  const dateStyles = new Set<number>();
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!cellXfs) return dateStyles;
  // Solo las etiquetas de apertura <xf ...> (autocerradas o no); el contenido
  // interno (<alignment/>, etc.) no importa para el formato numérico.
  let i = 0;
  for (const m of cellXfs[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) dateStyles.add(i);
    i++;
  }
  return dateStyles;
}

function readSharedStrings(files: Record<string, Uint8Array>) {
  const file = files["xl/sharedStrings.xml"];
  if (!file) return [] as string[];
  const xml = strFromU8(file);
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = "";
    for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1]);
    out.push(text);
  }
  return out;
}

function firstSheetPath(files: Record<string, Uint8Array>) {
  const wb = files["xl/workbook.xml"];
  if (wb) {
    const xml = strFromU8(wb);
    const sheet = xml.match(/<sheet\b[^>]*\/>/);
    const rels = files["xl/_rels/workbook.xml.rels"];
    if (sheet && rels) {
      const rid = attr(sheet[0], "r:id") || attr(sheet[0], "id");
      const name = attr(sheet[0], "name") || "Hoja1";
      const relsXml = strFromU8(rels);
      for (const r of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
        if (attr(r[0], "Id") === rid) {
          let target = attr(r[0], "Target") || "";
          target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
          if (files[target]) return { path: target, name };
        }
      }
    }
  }
  const fallback = Object.keys(files).find((k) => /^xl\/worksheets\/sheet\d*\.xml$/.test(k));
  if (!fallback) throw new Error("El archivo no contiene hojas de cálculo.");
  return { path: fallback, name: "Hoja1" };
}

/** Lee la primera hoja de un .xlsx. Las celdas vacías quedan como null. */
export function readFirstSheet(data: ArrayBuffer | Uint8Array): Sheet {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un .xlsx válido.");
  }
  const shared = readSharedStrings(files);
  const dateStyles = readDateStyles(files);
  const { path, name } = firstSheetPath(files);
  const xml = strFromU8(files[path]);
  const rows: CellValue[][] = [];
  const sheetData = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!sheetData) return { name, rows };
  for (const rowMatch of sheetData[1].matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(attr(rowMatch[1], "r") || rows.length + 1);
    while (rows.length < rowNumber - 1) rows.push([]);
    const row: CellValue[] = [];
    let auto = 0;
    for (const c of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], "r");
      const col = ref ? columnIndex(ref) : auto;
      auto = col + 1;
      const type = attr(c[1], "t") || "n";
      const style = Number(attr(c[1], "s") ?? -1);
      const inner = c[2] || "";
      let value: CellValue = null;
      if (type === "inlineStr") {
        let text = "";
        for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeXml(t[1]);
        value = text;
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (v) {
          const raw = decodeXml(v[1]);
          if (type === "s") value = shared[Number(raw)] ?? "";
          else if (type === "str") value = raw;
          else if (type === "b") value = raw === "1";
          else if (type === "e") value = null;
          else {
            const n = Number(raw);
            value = Number.isFinite(n) ? (dateStyles.has(style) ? excelSerialToDate(n) : n) : raw;
          }
        }
      }
      while (row.length < col) row.push(null);
      row[col] = value;
    }
    rows.push(row);
  }
  return { name, rows };
}

function cellXml(ref: string, value: CellValue) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  if (value instanceof Date) return `<c r="${ref}" t="inlineStr"><is><t>${value.toISOString()}</t></is></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${encodeXml(String(value))}</t></is></c>`;
}

/** Genera un .xlsx con una o más hojas (strings inline, sin estilos). */
export function writeWorkbook(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheetEntries = sheets.map((s, i) => ({
    id: i + 1,
    name: encodeXml(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " ") || `Hoja${i + 1}`),
  }));
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheetEntries
        .map(
          (s) =>
            `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      sheetEntries.map((s) => `<sheet name="${s.name}" sheetId="${s.id}" r:id="rId${s.id}"/>`).join("") +
      `</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheetEntries
        .map(
          (s) =>
            `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`,
        )
        .join("") +
      `</Relationships>`,
  );
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row.map((v, c) => cellXml(`${columnName(c)}${r + 1}`, v)).join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zipSync(files, { level: 6 });
}

/** Serializa filas a CSV (separador configurable, comillas cuando hace falta). */
export function toCsv(rows: CellValue[][], separator = ",") {
  const esc = (v: CellValue) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",;\t\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return " " + rows.map((r) => r.map(esc).join(separator)).join("\r\n");
}

/** Parser CSV tolerante: comillas, CRLF, BOM y separador coma/punto y coma/tab. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/)[0] || "";
  const delimiter = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"') {
      if (quoted && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("El archivo contiene comillas sin cerrar. Revisá el formato CSV.");
  row.push(cell);
  records.push(row);
  return records.filter((r) => r.some((c) => c.trim() !== ""));
}

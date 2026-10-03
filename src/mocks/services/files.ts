// Utilidades de archivos (port de apps/api/src/storage/files.ts) y un hash
// sincrónico para detectar reimportaciones (el servidor usa SHA-256).

export function safeFileName(name: string) {
  const base = String(name || "archivo").split(/[\\/]/).pop() || "archivo";
  return base.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ()]+/g, "_").slice(0, 120) || "archivo";
}

export function contentTypeFor(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  return (
    {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      tsv: "text/tab-separated-values",
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    } as Record<string, string>
  )[ext] || "application/octet-stream";
}

/** Hash de 64 bits (dos FNV-1a) en hexadecimal: suficiente para detectar archivos repetidos. */
export function hashHex(bytes: Uint8Array) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[(bytes.length - 1 - i) | 0], 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

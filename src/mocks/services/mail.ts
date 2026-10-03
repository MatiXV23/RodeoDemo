// Correo simulado: en lugar de enviar, guarda el mensaje en la bandeja de la
// demo y avisa a la interfaz para que muestre "Mail enviado a X (simulado)".

import { db, uuid, nowIso } from "../db";

export type MailKind = "invitacion" | "recuperacion" | "alertas";
export type DemoMail = { id: string; to: string; subject: string; body: string; link: string | null; kind: MailKind; createdAt: string };

export const MAIL_EVENT = "rodeo-demo:mail";

export function sendMail(msg: { to: string; subject: string; text: string; link?: string; kind: MailKind }) {
  const mail: DemoMail = { id: uuid(), to: msg.to, subject: msg.subject, body: msg.text, link: msg.link ?? null, kind: msg.kind, createdAt: nowIso() };
  db.mailOutbox.unshift({ id: mail.id, to: mail.to, subject: mail.subject, body: mail.body, link: mail.link, createdAt: mail.createdAt });
  db.mailOutbox = db.mailOutbox.slice(0, 30);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<DemoMail>(MAIL_EVENT, { detail: mail }));
  return mail;
}

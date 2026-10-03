// Genera las capturas de docs/screenshots navegando la demo con Playwright.
// Uso: npm run screenshots  (levanta su propio servidor de Vite en el puerto 5199)

import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "screenshots");
await mkdir(out, { recursive: true });

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const BASE = "http://localhost:5199/";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "es-UY", timezoneId: "America/Montevideo" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("dialog", (d) => d.accept());

const sleep = (ms) => page.waitForTimeout(ms);
const shot = async (name, options = {}) => {
  await sleep(450); // animaciones de entrada
  await page.screenshot({ path: path.join(out, name), ...options });
  console.log("✓", name);
};
const nav = async (name) => {
  await page.locator("[data-slot=sidebar-menu-button]", { hasText: name }).first().click();
  await sleep(600);
};
const pick = async (label, option, scope = page) => {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const dialog = () => page.getByRole("dialog").last();
const hideToasts = () => page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" });
// El botón flotante de la demo se oculta en las capturas de producto y se muestra en las del panel.
const fab = (visible) => page.evaluate((v) => document.body.classList.toggle("shots-hide-fab", !v), visible);
const charts = () => sleep(1700); // animaciones de Recharts

try {
  // Datos de ejemplo limpios.
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);

  // 1. Login con usuarios de prueba.
  await page.getByRole("button", { name: "Entrar como Martín" }).waitFor();
  await shot("01-login.png");

  // 2. Resumen del campo.
  await page.getByRole("button", { name: "Entrar como Martín" }).click();
  await page.getByText("Cada dato, una mejor decisión.").waitFor();
  await page.locator(".recharts-surface").first().waitFor();
  await hideToasts();
  await page.addStyleTag({ content: "body.shots-hide-fab .demo-fab-wrap{display:none!important}" });
  await fab(false);
  await charts();
  await shot("02-resumen.png");

  // 3. Detalle de lote con proyección y 4. costos.
  await nav("Lotes");
  await page.getByRole("button", { name: /Novillos compra marzo/ }).click();
  await page.getByText("días para el objetivo").waitFor();
  await charts();
  await shot("03-lote.png");
  await page.getByRole("tab", { name: "Costos y resultado" }).click();
  await page.getByText("Composición de los costos").waitFor();
  await shot("04-costos.png");

  // 5. Importación del lector: revisión fila por fila.
  await page.getByRole("button", { name: "Nuevo registro" }).click();
  await page.getByRole("menuitem", { name: "Importar pesada", exact: true }).click();
  await dialog().getByRole("button", { name: "Probar con el archivo de ejemplo" }).click();
  await page.getByRole("dialog", { name: "Resumen del archivo" }).waitFor();
  await shot("05-importar-resumen.png");
  await page.getByRole("dialog", { name: "Resumen del archivo" }).getByRole("button", { name: /Continuar|Revisar filas/ }).click();
  const sex = page.getByRole("dialog", { name: "Sexo distinto al registrado" });
  if (await sex.count()) await sex.getByRole("button", { name: /^Mantener/ }).first().click();
  const nw = page.getByRole("dialog", { name: "Animal nuevo" });
  await nw.waitFor();
  await nw.getByRole("button", { name: /Aplicar a todos los siguientes/ }).click();
  await page.locator(".import-table").waitFor();
  await page.getByRole("checkbox", { name: "Ver solo filas con observaciones" }).click();
  await shot("06-importar-revision.png");
  await page.keyboard.press("Escape");

  // 7. Venta con vista previa del resultado.
  await page.getByRole("button", { name: "Registrar venta" }).click();
  const boxes = dialog().locator(".animal-choice", { hasNotText: "retiro" }).locator("button[role=checkbox]");
  for (let i = 0; i < 12; i++) await boxes.nth(i).click();
  await dialog().getByLabel("Comprador").fill("Frigorífico Las Moras");
  await dialog().locator(".sale-preview").waitFor();
  await dialog().locator(".sale-preview").scrollIntoViewIfNeeded();
  await shot("07-venta.png");
  await page.keyboard.press("Escape");

  // 8. Simulador de venta y 9. mercado (ACG) vs. punto de equilibrio.
  await nav("Análisis");
  await page.setViewportSize({ width: 1440, height: 1290 });
  await page.getByText("MARGEN ESTIMADO A LOS").waitFor();
  await page.locator(".market-chart .recharts-area").first().waitFor();
  await charts();
  await shot("08-simulador-venta.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("tab", { name: "Mercado y costos" }).click();
  await page.locator(".market-chart .recharts-area").first().waitFor();
  await charts();
  await shot("09-mercado.png");

  // 10. Ficha de una vaca preñada y 11. animales a nombre del banco.
  await nav("Animales");
  await pick("Situación", "Preñadas (7)");
  await page.getByRole("button", { name: "Ver animal 302" }).click();
  await page.getByText("Parto estimado").waitFor();
  await page.getByText("Diagnóstico de preñez").first().waitFor();
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, 190);
  await shot("10-ficha-animal.png");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Volver a animales" }).click();
  await pick("Situación", "A nombre del banco (17)");
  await shot("11-animales.png");

  // 12. Invitación con correo simulado.
  await page.getByRole("button", { name: "Configuración" }).first().click();
  await page.getByRole("tab", { name: "Usuarios y roles" }).click();
  await page.getByRole("button", { name: "Invitar" }).click();
  await dialog().getByLabel("Correo de la persona").fill("veterinaria@campo.com");
  await dialog().getByRole("button", { name: "Enviar invitación" }).click();
  await page.locator(".demo-mail-dialog").waitFor();
  await shot("12-correo-simulado.png");
  await page.locator(".demo-mail-dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("dialog", { name: "Invitar a una persona" }).getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  // 13. Panel de la demo.
  await nav("Resumen");
  await fab(true);
  await charts();
  await page.getByRole("button", { name: "Abrir el panel de demo" }).click();
  await page.locator(".demo-panel").waitFor();
  await shot("13-panel-demo.png");
  await page.keyboard.press("Escape");

  // 15. Celular (propietario).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-nav").getByRole("button", { name: "Resumen" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await charts();
  await shot("15-celular.png");
  await page.setViewportSize({ width: 1440, height: 900 });

  // 14. Rol operario: carga datos sin ver montos.
  await page.getByRole("button", { name: "Abrir el panel de demo" }).click();
  await page.locator(".demo-user", { hasText: "Juan" }).click();
  await page.waitForLoadState("load");
  await page.getByText("Cada dato, una mejor decisión.").waitFor();
  await hideToasts();
  await nav("Compras y ventas");
  await shot("14-rol-operario.png");


  // Banner del README: marca, slogan y el resumen del campo.
  const dashboard = (await readFile(path.join(out, "02-resumen.png"))).toString("base64");
  const banner = await context.newPage();
  await banner.setViewportSize({ width: 1280, height: 560 });
  const html = (await readFile(path.join(root, "scripts", "banner.html"), "utf8")).replace("__SCREENSHOT__", `data:image/png;base64,${dashboard}`);
  await banner.setContent(html, { waitUntil: "networkidle" });
  await banner.screenshot({ path: path.join(root, "docs", "banner.png") });
  console.log("✓ banner.png");
} finally {
  await browser.close();
  await server.close();
}

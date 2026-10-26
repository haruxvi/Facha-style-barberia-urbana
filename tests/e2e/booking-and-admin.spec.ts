import { expect, test } from "@playwright/test";

/**
 * Flujos críticos de punta a punta (requiere el seed de desarrollo).
 * Credenciales solo de desarrollo, definidas en prisma/seed.ts.
 */
const DEV_OWNER = { email: "dueno@facha.dev", password: "FachaDev2026" };

test("un cliente reserva sin cuenta desde la página pública", async ({ page }) => {
  await page.goto("/b/facha-style?c=tarjeta");
  await expect(page.getByRole("heading", { name: /buenas manos/i })).toBeVisible();
  await page
    .getByRole("link", { name: /Reservar hora/ })
    .first()
    .click();

  await page.getByRole("button", { name: /Perfilado de barba/ }).click();
  await page.getByRole("button", { name: /Cualquier profesional/ }).click();

  // Prueba días hasta encontrar uno con horas libres (domingo no se trabaja en el seed).
  const days = page.locator("button[aria-pressed]");
  let found = false;
  for (let i = 1; i < 8 && !found; i++) {
    await days.nth(i).click();
    const slots = page.getByRole("button", { name: /^\d{2}:\d{2}$/ });
    try {
      await slots.first().waitFor({ timeout: 8000 });
      // Hueco al azar: corridas repetidas no compiten siempre por la misma hora.
      const count = await slots.count();
      await slots.nth(Math.floor(Math.random() * count)).click();
      found = true;
    } catch {
      /* siguiente día */
    }
  }
  expect(found).toBe(true);

  await page.getByRole("textbox", { name: /^Nombre y apellido/ }).fill("Cliente E2E");
  await page
    .getByRole("textbox", { name: /^WhatsApp/ })
    .fill(`+56 9 ${String(Date.now()).slice(-8, -4)} ${String(Date.now()).slice(-4)}`);
  await page.getByText("Acepto las condiciones de reserva").click();
  await page.getByRole("button", { name: /Confirmar reserva|Reservar y pagar/ }).click();

  // En `next dev` la primera compilación de la ruta puede tardar varios segundos.
  await expect(page).toHaveURL(/\/confirmacion\/|\/pagos\/simulador\//, { timeout: 30_000 });
  if (page.url().includes("/pagos/simulador/")) {
    await page.getByRole("button", { name: "Simular pago aprobado" }).click();
  }
  await expect(page.getByText("Confirmada")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Perfilado de barba")).toBeVisible();
});

test("la confirmación de otra reserva no revela datos sin el token", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/b/facha-style/confirmacion/00000000-0000-7000-8000-000000000000");
  await expect(page.getByText("Reserva registrada")).toBeVisible();
  const res = await page.request.get("/api/public/appointments/00000000-0000-7000-8000-000000000000/status");
  expect(res.status()).toBe(404);
  await ctx.close();
});

test("el panel exige login y el dueño entra al dashboard", async ({ page }) => {
  await page.goto("/admin/clientes");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Correo").fill(DEV_OWNER.email);
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText(/incorrectos/)).toBeVisible();

  await page.getByLabel("Correo").fill(DEV_OWNER.email);
  await page.getByLabel("Contraseña").fill(DEV_OWNER.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("heading", { name: "Hoy", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Agenda" }).first().click();
  await expect(page.getByRole("heading", { name: "Agenda", exact: true })).toBeVisible();
});

test("los webhooks rechazan firmas inválidas", async ({ request }) => {
  const wa = await request.post("/api/webhooks/whatsapp", {
    data: { object: "whatsapp_business_account", entry: [] },
    headers: { "x-hub-signature-256": "sha256=deadbeef" },
  });
  expect(wa.status()).toBe(401);
  const verify = await request.get(
    "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1",
  );
  expect(verify.status()).toBe(403);
  const cron = await request.get("/api/cron/jobs");
  expect(cron.status()).toBe(401);
});

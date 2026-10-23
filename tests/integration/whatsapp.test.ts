import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "@/modules/booking";
import { hasConsent } from "@/modules/crm";
import { runDueJobs } from "@/modules/jobs";
import { setProviderOverrides, type WhatsAppSender } from "@/modules/messaging";
import { saveIntegration } from "@/modules/tenancy";
import { ingestWhatsAppWebhook, verifySubscription } from "@/modules/whatsapp";
import { jobHandlers } from "@/server/worker";
import { hmacSha256 } from "@/shared/crypto";
import { db } from "@/shared/db";
import { bookingInput, createFixture, resetDb, santiagoIso, type Fixture } from "../helpers";
import { addDays, todayIn } from "@/shared/time";

const APP_SECRET = "test-whatsapp-app-secret";
const PHONE_ID = "109876543210";
const CUSTOMER_WA = "56998765432";

class Inbox implements WhatsAppSender {
  readonly name = "test_wa";
  readonly simulated = true;
  out: string[] = [];
  async sendText(_to: string, body: string) {
    this.out.push(body);
    return { providerMessageId: `wamid.out.${this.out.length}.${Math.random()}` };
  }
  async sendTemplate() {
    return { providerMessageId: "wamid.tpl" };
  }
}

let seq = 0;
function payload(text: string, opts: { id?: string; phoneId?: string; from?: string } = {}) {
  seq++;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "56900000000", phone_number_id: opts.phoneId ?? PHONE_ID },
              contacts: [{ wa_id: opts.from ?? CUSTOMER_WA, profile: { name: "Cliente WA" } }],
              messages: [
                {
                  from: opts.from ?? CUSTOMER_WA,
                  id: opts.id ?? `wamid.TEST.${seq}.${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function sign(body: string, secret = APP_SECRET) {
  return `sha256=${hmacSha256(secret, body, "hex")}`;
}

async function say(text: string) {
  const body = payload(text);
  const r = await ingestWhatsAppWebhook(body, sign(body));
  await runDueJobs(jobHandlers, { deadlineMs: 5000 });
  return r;
}

describe("WhatsApp: webhook y bot", () => {
  let f: Fixture;
  let inbox: Inbox;

  beforeEach(async () => {
    await resetDb();
    f = await createFixture();
    await saveIntegration(f.ctx, "WHATSAPP", { enabled: true, externalAccountId: PHONE_ID });
    inbox = new Inbox();
    setProviderOverrides({ whatsapp: () => inbox });
  });
  afterEach(() => setProviderOverrides({}));

  it("verificación inicial del webhook", () => {
    const ok = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "test-verify-token",
      "hub.challenge": "42",
    });
    expect(verifySubscription(ok)).toBe("42");
    const bad = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "otro",
      "hub.challenge": "42",
    });
    expect(verifySubscription(bad)).toBeNull();
  });

  it("firma inválida: se rechaza y no se guarda nada", async () => {
    const body = payload("hola");
    const r = await ingestWhatsAppWebhook(body, sign(body, "secreto-incorrecto"));
    expect(r.ok).toBe(false);
    expect(await db.conversationMessage.count()).toBe(0);
    expect((await ingestWhatsAppWebhook(body, null)).ok).toBe(false);
  });

  it("mensaje duplicado se procesa una sola vez", async () => {
    const body = payload("hola", { id: "wamid.DUP.1" });
    await ingestWhatsAppWebhook(body, sign(body));
    await ingestWhatsAppWebhook(body, sign(body));
    await runDueJobs(jobHandlers, { deadlineMs: 5000 });
    expect(await db.conversationMessage.count({ where: { direction: "INBOUND" } })).toBe(1);
    expect(inbox.out).toHaveLength(1);
  });

  it("identifica la barbería por el número receptor e ignora números desconocidos", async () => {
    const other = await createFixture();
    await saveIntegration(other.ctx, "WHATSAPP", { enabled: true, externalAccountId: "555000" });
    await say("hola");
    const conv = await db.conversation.findFirstOrThrow();
    expect(conv.tenantId).toBe(f.tenantId);
    const unknown = payload("hola", { phoneId: "999999" });
    const r = await ingestWhatsAppWebhook(unknown, sign(unknown));
    expect(r.inbound).toHaveLength(0);
  });

  it("flujo completo: reserva creada por el bot con el mismo motor de reservas", async () => {
    await say("hola");
    expect(inbox.out.at(-1)).toContain("Reservar");
    await say("1"); // reservar → única sucursal → servicios
    expect(inbox.out.at(-1)).toContain("Corte");
    await say("1"); // Corte → barberos
    expect(inbox.out.at(-1)).toContain("Cualquier profesional");
    await say("1"); // Barbero A → días
    expect(inbox.out.at(-1)).toContain("¿Qué día?");
    await say("2"); // segundo día disponible (evita depender de la hora actual)
    expect(inbox.out.at(-1)).toContain("Horas disponibles");
    await say("1"); // primera hora → pide nombre
    expect(inbox.out.at(-1)).toContain("nombre");
    await say("Juan Pérez");
    expect(inbox.out.at(-1)).toContain("SÍ");
    await say("sí");
    expect(inbox.out.at(-1)).toContain("Reserva confirmada");
    const appt = await db.appointment.findFirstOrThrow({
      where: { tenantId: f.tenantId },
      include: { customer: true },
    });
    expect(appt.source).toBe("WHATSAPP");
    expect(appt.status).toBe("CONFIRMED");
    expect(appt.customer.phoneE164).toBe(`+${CUSTOMER_WA}`);
    expect(appt.customer.name).toBe("Juan Pérez");
    expect(await hasConsent(appt.customerId, "WHATSAPP", "TRANSACTIONAL")).toBe(true);
    // No se creó ninguna cuenta para el cliente
    expect(await db.user.count()).toBe(1);
  });

  it("conversación incompleta y entrada inválida", async () => {
    await say("1");
    await say("banana");
    expect(inbox.out.at(-1)).toContain("No te entendí");
    const conv = await db.conversation.findFirstOrThrow();
    expect(conv.state).toBe("service");
    await say("menu");
    expect((await db.conversation.findFirstOrThrow()).state).toBe("idle");
  });

  it("hora tomada mientras el cliente confirmaba: ofrece otras", async () => {
    await say("1");
    await say("1");
    await say("1");
    await say("2");
    await say("1");
    await say("Ana Soto");
    const conv = await db.conversation.findFirstOrThrow();
    const startsAt = (conv.context as { startsAt: string }).startsAt;
    // Otra persona reserva ese mismo horario por la web
    await createBooking(
      f.tenantId,
      bookingInput(f, startsAt, { customer: { name: "Web", phone: "+56911112222" } }),
      { source: "WEB", actor: { type: "CUSTOMER" } },
    );
    await say("si");
    expect(inbox.out.some((m) => m.includes("se acaba de ocupar"))).toBe(true);
    expect((await db.conversation.findFirstOrThrow()).state).toBe("time");
    expect(await db.appointment.count({ where: { source: "WHATSAPP" } })).toBe(0);
  });

  it("consultar mis reservas solo muestra las del número remitente", async () => {
    const date = addDays(todayIn("America/Santiago"), 3);
    await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), { customer: { name: "Yo", phone: `+${CUSTOMER_WA}` } }),
      {
        source: "WEB",
        actor: { type: "CUSTOMER" },
      },
    );
    await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "12:00"), { customer: { name: "Otro", phone: "+56911113333" } }),
      {
        source: "WEB",
        actor: { type: "CUSTOMER" },
      },
    );
    await say("2");
    const reply = inbox.out.at(-1)!;
    expect(reply).toContain("/reservas/gestionar/");
    expect(reply.match(/gestionar\//g)).toHaveLength(1);
  });

  it("derivación a una persona: el bot deja de responder", async () => {
    await say("quiero hablar con una persona");
    expect(inbox.out.at(-1)).toContain("persona del equipo");
    expect((await db.conversation.findFirstOrThrow()).handoff).toBe(true);
    const before = inbox.out.length;
    await say("hola?");
    expect(inbox.out.length).toBe(before);
  });

  it("BAJA revoca el consentimiento", async () => {
    const date = addDays(todayIn("America/Santiago"), 3);
    const r = await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), { customer: { name: "Yo", phone: `+${CUSTOMER_WA}` } }),
      {
        source: "WEB",
        actor: { type: "CUSTOMER" },
      },
    );
    expect(await hasConsent(r.appointment.customerId, "WHATSAPP", "TRANSACTIONAL")).toBe(true);
    await say("BAJA");
    expect(await hasConsent(r.appointment.customerId, "WHATSAPP", "TRANSACTIONAL")).toBe(false);
  });
});

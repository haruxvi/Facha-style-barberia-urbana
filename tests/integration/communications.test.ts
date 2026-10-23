import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBooking, rescheduleAppointment, transitionAppointment } from "@/modules/booking";
import { setConsent } from "@/modules/crm";
import { runDueJobs } from "@/modules/jobs";
import {
  ProviderError,
  renderTemplate,
  saveTemplate,
  sendManualMessage,
  setProviderOverrides,
  unknownVariables,
  type EmailProvider,
  type WhatsAppSender,
} from "@/modules/messaging";
import { jobHandlers } from "@/server/worker";
import { db } from "@/shared/db";
import { bookingInput, createFixture, futureDate, resetDb, santiagoIso, type Fixture } from "../helpers";

class RecordingWhatsApp implements WhatsAppSender {
  readonly name = "test_wa";
  readonly simulated = true;
  sent: { to: string; body: string }[] = [];
  failNext = 0;
  async sendText(to: string, body: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new ProviderError("WhatsApp 503", true);
    }
    this.sent.push({ to, body });
    return { providerMessageId: `wamid.${this.sent.length}.${Date.now()}` };
  }
  async sendTemplate(to: string, template: string, _lang: string, params: string[]) {
    this.sent.push({ to, body: `[${template}] ${params.join("|")}` });
    return { providerMessageId: `wamid.t${this.sent.length}` };
  }
}

class RecordingEmail implements EmailProvider {
  readonly name = "test_email";
  readonly simulated = true;
  sent: { to: string; subject: string; html: string }[] = [];
  async send(m: { to: string; subject: string; html: string }) {
    this.sent.push(m);
    return { providerMessageId: `email-${this.sent.length}` };
  }
}

/** Ejecuta la cola como lo haría el cron, ignorando el backoff para el test. */
async function drain() {
  for (let i = 0; i < 5; i++) {
    await db.job.updateMany({
      where: { status: "PENDING", type: { not: "notification.send" } },
      data: { runAt: new Date(0) },
    });
    await db.job.updateMany({
      where: { status: "PENDING", type: "notification.send", runAt: { lte: new Date(Date.now() + 60000) } },
      data: { runAt: new Date(0) },
    });
    await runDueJobs(jobHandlers, { deadlineMs: 5000 });
  }
}

describe("comunicaciones y automatizaciones", () => {
  let f: Fixture;
  let wa: RecordingWhatsApp;
  let email: RecordingEmail;
  const date = futureDate(3);

  beforeEach(async () => {
    await resetDb();
    f = await createFixture();
    wa = new RecordingWhatsApp();
    email = new RecordingEmail();
    setProviderOverrides({ whatsapp: () => wa, email });
  });
  afterEach(() => setProviderOverrides({}));

  it("confirmación automática por WhatsApp con enlace de gestión, y recordatorio programado", async () => {
    await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0]!.to).toBe("+56912345678");
    expect(wa.sent[0]!.body).toContain("/reservas/gestionar/");
    expect(wa.sent[0]!.body).toContain("Corte");
    // Sin email → sin correo, pero la reserva funciona igual
    expect(email.sent).toHaveLength(0);
    const reminder = await db.notification.findFirstOrThrow({ where: { trigger: "REMINDER" } });
    expect(reminder.status).toBe("QUEUED");
    expect(reminder.scheduledFor.getTime()).toBeGreaterThan(Date.now());
  });

  it("sin consentimiento no se envía", async () => {
    await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), {
        consents: { whatsapp: false, email: false, marketing: false },
      }),
      { source: "WEB", actor: { type: "CUSTOMER" } },
    );
    await drain();
    expect(wa.sent).toHaveLength(0);
    const n = await db.notification.findFirstOrThrow({
      where: { trigger: "BOOKING_CONFIRMED", channel: "WHATSAPP" },
    });
    expect(n.status).toBe("SKIPPED");
  });

  it("reserva cancelada antes del recordatorio: el recordatorio no se envía y llega el aviso de cancelación", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    await transitionAppointment(f.tenantId, r.appointment.id, "cancel", { actor: { type: "CUSTOMER" } });
    await db.notification.updateMany({ where: { trigger: "REMINDER" }, data: { scheduledFor: new Date() } });
    await db.job.updateMany({ where: { type: "notification.send" }, data: { runAt: new Date(0) } });
    await drain();
    const reminder = await db.notification.findFirstOrThrow({ where: { trigger: "REMINDER" } });
    expect(["CANCELLED", "SKIPPED"]).toContain(reminder.status);
    expect(wa.sent.map((s) => s.body).some((b) => b.includes("cancelada"))).toBe(true);
    expect(wa.sent.filter((s) => s.body.includes("te recordamos"))).toHaveLength(0);
  });

  it("reprogramación: aviso de cambio y el recordatorio viejo se descarta", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    await rescheduleAppointment(
      f.tenantId,
      r.appointment.id,
      { startsAt: santiagoIso(date, "15:00") },
      { actor: { type: "CUSTOMER" } },
    );
    await drain();
    expect(wa.sent.some((s) => s.body.includes("ahora es"))).toBe(true);
    const reminders = await db.notification.findMany({
      where: { trigger: "REMINDER" },
      orderBy: { createdAt: "asc" },
    });
    expect(reminders).toHaveLength(2);
    await db.notification.updateMany({ where: { trigger: "REMINDER" }, data: { scheduledFor: new Date() } });
    await db.job.updateMany({
      where: { type: "notification.send", status: "PENDING" },
      data: { runAt: new Date(0) },
    });
    await drain();
    const after = await db.notification.findMany({
      where: { trigger: "REMINDER" },
      orderBy: { createdAt: "asc" },
    });
    expect(after[0]!.status).toBe("SKIPPED");
    expect(after[1]!.status).toBe("SENT");
  });

  it("reprocesar el evento no duplica mensajes", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    await jobHandlers["booking.event"]!(
      { appointmentId: r.appointment.id, event: "confirmed" },
      null as never,
    );
    await drain();
    expect(wa.sent).toHaveLength(1);
    expect(
      await db.notification.count({ where: { trigger: "BOOKING_CONFIRMED", channel: "WHATSAPP" } }),
    ).toBe(1);
  });

  it("error del proveedor: reintento controlado y luego éxito", async () => {
    wa.failNext = 1;
    await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    const n = await db.notification.findFirstOrThrow({
      where: { trigger: "BOOKING_CONFIRMED", channel: "WHATSAPP" },
    });
    expect(n.status).toBe("SENT");
    expect(n.attempts).toBe(2);
    expect(wa.sent).toHaveLength(1);
  });

  it("envío manual: registra quién envió, evita duplicados por doble clic", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await drain();
    const before = wa.sent.length;
    const input = {
      customerId: r.appointment.customerId,
      appointmentId: r.appointment.id,
      channel: "WHATSAPP" as const,
      body: "Hola {{customer_name}}, te esperamos a las {{appointment_time}}",
    };
    const a = await sendManualMessage(f.ctx, input);
    const b = await sendManualMessage(f.ctx, input);
    expect(a.id).toBe(b.id);
    expect(wa.sent.length - before).toBe(1);
    expect(wa.sent.at(-1)!.body).toMatch(/Hola Cliente, te esperamos a las 11:00/);
    const n = await db.notification.findUniqueOrThrow({ where: { id: a.id } });
    expect(n.createdById).toBe(f.ownerId);
    await expect(sendManualMessage(f.ctx, { ...input, body: "{{password}}" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("correo: escapa variables (sin inyección HTML) e incluye baja", async () => {
    const r = await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), {
        customer: {
          name: "<script>alert(1)</script> Pérez",
          phone: "+56912345678",
          email: "cliente@test.local",
        },
        consents: { whatsapp: false, email: true, marketing: false },
      }),
      { source: "WEB", actor: { type: "CUSTOMER" } },
    );
    await drain();
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.html).not.toContain("<script>");
    expect(email.sent[0]!.html).toContain("&lt;script&gt;");
    expect(email.sent[0]!.html).toContain("/baja/");
    await setConsent(f.tenantId, r.appointment.customerId, "EMAIL", "TRANSACTIONAL", false, "test", {
      type: "CUSTOMER",
    });
    await transitionAppointment(f.tenantId, r.appointment.id, "cancel", { actor: { type: "CUSTOMER" } });
    await drain();
    expect(email.sent).toHaveLength(1);
  });

  it("plantillas: variables permitidas y escapado", async () => {
    expect(unknownVariables("Hola {{customer_name}} {{secret}}")).toEqual(["secret"]);
    expect(renderTemplate("<b>{{customer_name}}</b>", { customer_name: "<i>x</i>" }, "html")).toBe(
      "<b>&lt;i&gt;x&lt;/i&gt;</b>",
    );
    expect(renderTemplate("{{customer_name}}", { customer_name: "a\u0000b\nc" }, "text")).toBe("a b c");
    await expect(
      saveTemplate(f.ctx, { key: "x_custom", channel: "WHATSAPP", name: "X", body: "{{token}}" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBooking,
  createManageToken,
  getPublicAppointment,
  paymentRequirementFor,
  rescheduleAppointment,
  revokeManageToken,
  transitionAppointment,
  verifyManageToken,
} from "@/modules/booking";
import { loadAvailability } from "@/modules/scheduling";
import { db } from "@/shared/db";
import { AppError } from "@/shared/errors";
import { addMinutes } from "@/shared/time";
import { bookingInput, createFixture, futureDate, resetDb, santiagoIso, type Fixture } from "../helpers";

const customerActor = { type: "CUSTOMER" as const };

describe("motor de reservas", () => {
  let f: Fixture;
  const date = futureDate(3);

  beforeAll(resetDb);
  beforeEach(async () => {
    f = await createFixture();
  });

  it("crea una reserva sin cuenta de usuario y con email opcional", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: customerActor,
    });
    expect(r.appointment.status).toBe("CONFIRMED");
    expect(r.manageToken).toMatch(/\./);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: r.appointment.customerId } });
    expect(customer.email).toBeNull();
    expect(customer.phoneE164).toBe("+56912345678");
    // No se crea ningún usuario para el cliente
    expect(await db.user.count({ where: { email: { contains: "cliente" } } })).toBe(0);
    // Evento outbox para las automatizaciones
    expect(await db.job.count({ where: { type: "booking.event" } })).toBe(1);
  });

  it("el precio y la duración los decide el servidor y quedan congelados", async () => {
    const r = await createBooking(
      f.tenantId,
      { ...bookingInput(f, santiagoIso(date, "12:00")), priceAmount: 1 } as never,
      { source: "WEB", actor: customerActor },
    );
    expect(r.appointment.priceAmount).toBe(15000);
    await db.service.update({
      where: { id: f.serviceId },
      data: { priceAmount: 99999, durationMinutes: 90 },
    });
    const again = await db.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } });
    expect(again.priceAmount).toBe(15000);
    expect(again.durationMinutes).toBe(30);
    expect(again.blockedUntil.getTime() - again.startsAt.getTime()).toBe(40 * 60000);
  });

  it("rechaza teléfono inválido", async () => {
    const input = bookingInput(f, santiagoIso(date, "11:00"), {
      customer: { name: "X Y", phone: "12345", email: "" },
    });
    await expect(
      createBooking(f.tenantId, input, { source: "WEB", actor: customerActor }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("exige aceptar condiciones", async () => {
    const input = { ...bookingInput(f, santiagoIso(date, "11:00")), acceptTerms: false };
    await expect(
      createBooking(f.tenantId, input as never, { source: "WEB", actor: customerActor }),
    ).rejects.toThrow();
  });

  it("rechaza horarios fuera del horario laboral", async () => {
    await expect(
      createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "08:00")), {
        source: "WEB",
        actor: customerActor,
      }),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("idempotencia: la misma petición repetida no duplica la reserva", async () => {
    const input = bookingInput(f, santiagoIso(date, "13:00"), { idempotencyKey: "idem-key-123456" });
    const a = await createBooking(f.tenantId, input, { source: "WEB", actor: customerActor });
    const b = await createBooking(f.tenantId, input, { source: "WEB", actor: customerActor });
    expect(b.replay).toBe(true);
    expect(b.appointment.id).toBe(a.appointment.id);
    expect(await db.appointment.count({ where: { tenantId: f.tenantId } })).toBe(1);
  });

  it("previene solapes, incluido el buffer", async () => {
    await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "15:00")), {
      source: "WEB",
      actor: customerActor,
    });
    // 15:30 choca con el buffer (15:00 + 30 + 10 = 15:40)
    await expect(
      createBooking(
        f.tenantId,
        bookingInput(f, santiagoIso(date, "15:30"), { customer: { name: "Otro", phone: "+56987654321" } }),
        {
          source: "WEB",
          actor: customerActor,
        },
      ),
    ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
    // El otro barbero sí está libre
    const ok = await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "15:30"), {
        barberId: f.barberIds[1],
        customer: { name: "Otro", phone: "+56987654321" },
      }),
      { source: "WEB", actor: customerActor },
    );
    expect(ok.appointment.barberId).toBe(f.barberIds[1]);
  });

  it("reservas concurrentes del mismo hueco: solo una gana (restricción de exclusión)", async () => {
    const start = santiagoIso(date, "16:00");
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        createBooking(
          f.tenantId,
          bookingInput(f, start, { customer: { name: `Cliente ${i}`, phone: `+5691111111${i}` } }),
          { source: "WEB", actor: customerActor },
        ),
      ),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const a of attempts.filter((x) => x.status === "rejected")) {
      expect((a as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
      expect((a as PromiseRejectedResult).reason.code).toBe("SLOT_UNAVAILABLE");
    }
  });

  it("la BD rechaza solapes aunque se salte la validación de la aplicación", async () => {
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "17:00")), {
      source: "WEB",
      actor: customerActor,
    });
    const a = r.appointment;
    await expect(
      db.appointment.create({
        data: {
          ...a,
          id: undefined,
          idempotencyKey: null,
          startsAt: addMinutes(a.startsAt, 10),
          endsAt: addMinutes(a.endsAt, 10),
          blockedUntil: addMinutes(a.blockedUntil, 10),
        } as never,
      }),
    ).rejects.toThrow(/no_overlap|23P01|exclusion/i);
  });

  it("'cualquier barbero' concurrente: si uno se ocupa, se asigna el otro", async () => {
    const start = santiagoIso(date, "19:00");
    const results = await Promise.allSettled(
      [0, 1].map((i) =>
        createBooking(
          f.tenantId,
          bookingInput(f, start, {
            barberId: null,
            customer: { name: `Simultáneo ${i}`, phone: `+5698888777${i}` },
          }),
          { source: "WEB", actor: customerActor },
        ),
      ),
    );
    const ok = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<{ appointment: { barberId: string } }>).value);
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.appointment.barberId)).size).toBe(2);
  });

  it("'cualquier barbero' asigna uno libre", async () => {
    await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "18:00")), {
      source: "WEB",
      actor: customerActor,
    });
    const r = await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "18:00"), {
        barberId: null,
        customer: { name: "Otro", phone: "+56987654321" },
      }),
      { source: "WEB", actor: customerActor },
    );
    expect(r.appointment.barberId).toBe(f.barberIds[1]);
  });

  it("reutiliza la ficha del cliente con el mismo teléfono", async () => {
    await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "10:00")), {
      source: "WEB",
      actor: customerActor,
    });
    await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), {
        customer: { name: "Nombre Distinto", phone: "9 1234 5678", email: "c@x.cl" },
      }),
      { source: "WEB", actor: customerActor },
    );
    const customers = await db.customer.findMany({ where: { tenantId: f.tenantId } });
    expect(customers).toHaveLength(1);
    expect(customers[0]!.name).toBe("Cliente Prueba");
    expect(customers[0]!.email).toBe("c@x.cl");
  });

  describe("holds de pago", () => {
    it("pendiente de pago bloquea el hueco y al expirar lo libera", async () => {
      const g = await createFixture({ paymentPolicy: "DEPOSIT_REQUIRED" });
      const now = new Date();
      const r = await createBooking(g.tenantId, bookingInput(g, santiagoIso(date, "12:00")), {
        source: "WEB",
        actor: customerActor,
        now,
      });
      expect(r.appointment.status).toBe("PENDING_PAYMENT");
      expect(r.appointment.amountDue).toBe(5000);
      const service = { id: g.serviceId, durationMinutes: 30, bufferMinutes: 10 };
      const before = await loadAvailability({
        tenantId: g.tenantId,
        branchId: g.branchId,
        service,
        barberId: g.barberIds[0],
        date,
        now,
      });
      expect(before.slots.some((s) => s.startsAt.toISOString() === santiagoIso(date, "12:00"))).toBe(false);
      // 20 minutos después (hold = 15 min) el hueco vuelve a estar libre y otra persona puede reservarlo
      const later = addMinutes(now, 20);
      const after = await loadAvailability({
        tenantId: g.tenantId,
        branchId: g.branchId,
        service,
        barberId: g.barberIds[0],
        date,
        now: later,
      });
      expect(after.slots.some((s) => s.startsAt.toISOString() === santiagoIso(date, "12:00"))).toBe(true);
      const second = await createBooking(
        g.tenantId,
        bookingInput(g, santiagoIso(date, "12:00"), { customer: { name: "Otro", phone: "+56987654321" } }),
        { source: "WEB", actor: customerActor, now: later },
      );
      expect(second.appointment.status).toBe("PENDING_PAYMENT");
      const first = await db.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } });
      expect(first.status).toBe("EXPIRED");
    });

    it("política de pago", () => {
      expect(paymentRequirementFor("NONE", 15000, 5000, true)).toEqual({ requirement: "NONE", amountDue: 0 });
      expect(paymentRequirementFor("OPTIONAL", 15000, 5000, true)).toEqual({
        requirement: "FULL",
        amountDue: 15000,
      });
      expect(paymentRequirementFor("OPTIONAL", 15000, 5000, false)).toEqual({
        requirement: "NONE",
        amountDue: 0,
      });
      expect(paymentRequirementFor("DEPOSIT_REQUIRED", 3000, 5000, false)).toEqual({
        requirement: "DEPOSIT",
        amountDue: 3000,
      });
      expect(paymentRequirementFor("FULL_REQUIRED", 15000, 0, false)).toEqual({
        requirement: "FULL",
        amountDue: 15000,
      });
    });
  });

  describe("cancelación y reprogramación", () => {
    it("el cliente cancela dentro de la política y el hueco se libera", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      const c = await transitionAppointment(f.tenantId, r.appointment.id, "cancel", {
        actor: customerActor,
        enforceCustomerPolicy: true,
      });
      expect(c.status).toBe("CANCELLED");
      const again = await createBooking(
        f.tenantId,
        bookingInput(f, santiagoIso(date, "11:00"), { customer: { name: "Otro", phone: "+56987654321" } }),
        { source: "WEB", actor: customerActor },
      );
      expect(again.appointment.status).toBe("CONFIRMED");
    });

    it("rechaza cancelación del cliente fuera de la ventana", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      const now = addMinutes(r.appointment.startsAt, -60); // ventana por defecto: 180 min
      await expect(
        transitionAppointment(f.tenantId, r.appointment.id, "cancel", {
          actor: customerActor,
          enforceCustomerPolicy: true,
          now,
        }),
      ).rejects.toMatchObject({ code: "POLICY" });
      // El personal sí puede
      const staff = await transitionAppointment(f.tenantId, r.appointment.id, "cancel", {
        actor: { type: "STAFF" },
        now,
      });
      expect(staff.status).toBe("CANCELLED");
    });

    it("reprograma validando disponibilidad", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      await createBooking(
        f.tenantId,
        bookingInput(f, santiagoIso(date, "14:00"), { customer: { name: "Otro", phone: "+56987654321" } }),
        { source: "WEB", actor: customerActor },
      );
      await expect(
        rescheduleAppointment(
          f.tenantId,
          r.appointment.id,
          { startsAt: santiagoIso(date, "14:00") },
          { actor: customerActor },
        ),
      ).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
      // Mover 15 minutos sobre su propio horario sí es posible (no choca consigo misma)
      const moved = await rescheduleAppointment(
        f.tenantId,
        r.appointment.id,
        { startsAt: santiagoIso(date, "11:15") },
        { actor: customerActor },
      );
      expect(moved.startsAt.toISOString()).toBe(santiagoIso(date, "11:15"));
      expect(
        await db.appointmentEvent.count({ where: { appointmentId: r.appointment.id, type: "rescheduled" } }),
      ).toBe(1);
    });

    it("no se puede marcar atendida una cita futura; a la hora sí, y suma la visita", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      await expect(
        transitionAppointment(f.tenantId, r.appointment.id, "complete", { actor: { type: "STAFF" } }),
      ).rejects.toMatchObject({
        code: "POLICY",
      });
      const atTime = addMinutes(r.appointment.startsAt, 30);
      const done = await transitionAppointment(f.tenantId, r.appointment.id, "complete", {
        actor: { type: "STAFF" },
        now: atTime,
      });
      expect(done.status).toBe("COMPLETED");
      const c = await db.customer.findUniqueOrThrow({ where: { id: r.appointment.customerId } });
      expect(c.visitCount).toBe(1);
    });

    it("no permite transiciones inválidas", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      await transitionAppointment(f.tenantId, r.appointment.id, "cancel", { actor: customerActor });
      await expect(
        transitionAppointment(f.tenantId, r.appointment.id, "complete", { actor: { type: "STAFF" } }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
  });

  describe("token de gestión", () => {
    it("válido, alterado, revocado y expirado", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      const ok = await verifyManageToken(r.manageToken);
      expect(ok).toEqual({ ok: true, appointmentId: r.appointment.id, tenantId: f.tenantId });

      const tampered = r.manageToken.slice(0, -2) + (r.manageToken.endsWith("A") ? "BB" : "AA");
      expect(await verifyManageToken(tampered)).toEqual({ ok: false, reason: "invalid" });
      expect(await verifyManageToken("basura")).toEqual({ ok: false, reason: "invalid" });

      // Token de otra cita no da acceso a esta: el id va firmado
      const forged = createManageToken("00000000-0000-7000-8000-000000000000", 1);
      expect((await verifyManageToken(forged)).ok).toBe(false);

      const expired = await verifyManageToken(r.manageToken, addMinutes(r.appointment.startsAt, 25 * 60));
      expect(expired).toEqual({ ok: false, reason: "expired" });

      await revokeManageToken(f.tenantId, r.appointment.id, { type: "STAFF" });
      expect(await verifyManageToken(r.manageToken)).toEqual({ ok: false, reason: "revoked" });
    });

    it("la vista pública no expone historial ni teléfono", async () => {
      const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
        source: "WEB",
        actor: customerActor,
      });
      const pub = await getPublicAppointment(f.tenantId, r.appointment.id);
      expect(pub).not.toBeNull();
      const json = JSON.stringify(pub);
      expect(json).not.toContain("+56912345678");
      expect(json).not.toContain("visitCount");
    });
  });
});

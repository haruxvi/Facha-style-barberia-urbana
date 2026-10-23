import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createBooking, transitionAppointment } from "@/modules/booking";
import {
  buildFakeEvent,
  handlePaymentWebhook,
  MercadoPagoGateway,
  reconcilePayment,
  refundPayment,
  setGatewayOverride,
  signFakeEvent,
  startCheckout,
  type FakeProviderEvent,
} from "@/modules/payments";
import { db } from "@/shared/db";
import { hmacSha256 } from "@/shared/crypto";
import { addMinutes } from "@/shared/time";
import { bookingInput, createFixture, futureDate, resetDb, santiagoIso, type Fixture } from "../helpers";

const date = futureDate(4);

async function pendingBooking(f: Fixture, hhmm = "12:00", phone = "+56912345678") {
  const r = await createBooking(
    f.tenantId,
    bookingInput(f, santiagoIso(date, hhmm), { customer: { name: "Pagador", phone } }),
    {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    },
  );
  const { paymentId } = await startCheckout(f.tenantId, r.appointment.id);
  return { appointmentId: r.appointment.id, paymentId };
}

function fakeRequest(event: FakeProviderEvent, opts: { badSignature?: boolean } = {}) {
  const { body, signature } = signFakeEvent(event);
  return {
    headers: new Headers({ "x-fake-signature": opts.badSignature ? "0".repeat(64) : signature }),
    url: new URL("http://localhost/api/webhooks/fake/x"),
    rawBody: body,
  };
}

describe("pagos (proveedor simulado, mismo pipeline que producción)", () => {
  let f: Fixture;
  beforeAll(async () => {
    await resetDb();
    f = await createFixture({ paymentPolicy: "DEPOSIT_REQUIRED" });
  });

  it("checkout creado con el importe del servidor y reutilizado", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "10:00", "+56911111111");
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.amount).toBe(5000);
    expect(p.provider).toBe("FAKE");
    expect(p.checkoutUrl).toContain(`/pagos/simulador/${paymentId}`);
    const again = await startCheckout(f.tenantId, appointmentId);
    expect(again.paymentId).toBe(paymentId);
  });

  it("pago aprobado confirma la reserva; el retorno del navegador no confirma nada", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "11:00", "+56911111112");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "PENDING_PAYMENT",
    );
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" })),
    );
    expect(res).toEqual({ status: "processed", result: "approved:confirmed" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "CONFIRMED",
    );
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("APPROVED");
  });

  it("pago rechazado deja la reserva pendiente", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "12:00", "+56911111113");
    await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "rejected", amount: 5000, currency: "CLP" })),
    );
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("REJECTED");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("firma inválida: no cambia nada", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "13:00", "+56911111114");
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" }), {
        badSignature: true,
      }),
    );
    expect(res.status).toBe("invalid_signature");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("evento duplicado se procesa una sola vez", async () => {
    const { paymentId } = await pendingBooking(f, "14:00", "+56911111115");
    const ev = buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" });
    const first = await handlePaymentWebhook("FAKE", f.tenantId, fakeRequest(ev));
    const second = await handlePaymentWebhook("FAKE", f.tenantId, fakeRequest(ev));
    expect(first.status).toBe("processed");
    expect(second).toEqual({ status: "duplicate" });
    expect(
      await db.appointmentEvent.count({
        where: { type: "payment_approved", data: { path: ["paymentId"], equals: paymentId } },
      }),
    ).toBe(1);
  });

  it("evento fuera de orden no revierte un pago aprobado", async () => {
    const { paymentId } = await pendingBooking(f, "15:00", "+56911111116");
    const t = Date.now();
    await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(
        buildFakeEvent({
          paymentId,
          status: "approved",
          amount: 5000,
          currency: "CLP",
          updatedAt: new Date(t).toISOString(),
        }),
      ),
    );
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(
        buildFakeEvent({
          paymentId,
          status: "pending",
          amount: 5000,
          currency: "CLP",
          updatedAt: new Date(t - 60000).toISOString(),
        }),
      ),
    );
    expect(res).toEqual({ status: "processed", result: "stale" });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("APPROVED");
  });

  it("importe incorrecto o moneda incorrecta: no se aprueba", async () => {
    const one = await pendingBooking(f, "16:00", "+56911111117");
    const r1 = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(
        buildFakeEvent({ paymentId: one.paymentId, status: "approved", amount: 100, currency: "CLP" }),
      ),
    );
    expect(r1.status).toBe("ignored");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: one.appointmentId } })).status).toBe(
      "PENDING_PAYMENT",
    );

    const two = await pendingBooking(f, "17:00", "+56911111118");
    const r2 = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(
        buildFakeEvent({ paymentId: two.paymentId, status: "approved", amount: 5000, currency: "USD" }),
      ),
    );
    expect(r2.status).toBe("ignored");
    expect((await db.payment.findUniqueOrThrow({ where: { id: two.paymentId } })).status).toBe("PENDING");
    expect(
      await db.auditLog.count({
        where: { action: { in: ["payment.amount_mismatch", "payment.currency_mismatch"] } },
      }),
    ).toBe(2);
  });

  it("una barbería no puede aprobar pagos de otra", async () => {
    const g = await createFixture({ paymentPolicy: "DEPOSIT_REQUIRED" });
    const { appointmentId, paymentId } = await pendingBooking(g, "17:30", "+56911111119");
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" })),
    );
    expect(res.status).toBe("ignored");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "PENDING_PAYMENT",
    );
  });

  it("reserva cancelada durante el pago: queda marcada para reembolso y se reembolsa", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "18:00", "+56911111120");
    await transitionAppointment(f.tenantId, appointmentId, "cancel", { actor: { type: "CUSTOMER" } });
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" })),
    );
    expect(res).toEqual({ status: "processed", result: "approved:cancelled" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "CANCELLED",
    );
    expect(
      await db.auditLog.count({ where: { action: "payment.requires_refund", entityId: paymentId } }),
    ).toBe(1);

    await refundPayment(f.ctx, paymentId);
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true } });
    expect(p.status).toBe("REFUNDED");
    expect(p.refundedAmount).toBe(5000);
    expect(p.refunds[0]!.status).toBe("approved");
    await expect(refundPayment(f.ctx, paymentId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("hold expirado y pago tardío: se revive si el hueco sigue libre", async () => {
    const { appointmentId, paymentId } = await pendingBooking(f, "19:00", "+56911111121");
    await db.appointment.update({ where: { id: appointmentId }, data: { status: "EXPIRED" } });
    const res = await handlePaymentWebhook(
      "FAKE",
      f.tenantId,
      fakeRequest(buildFakeEvent({ paymentId, status: "approved", amount: 5000, currency: "CLP" })),
    );
    expect(res).toEqual({ status: "processed", result: "approved:revived" });
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe(
      "CONFIRMED",
    );
  });
});

describe("Mercado Pago (adaptador con API simulada)", () => {
  afterEach(() => setGatewayOverride(null));

  const secret = "mp-secret-test";

  function signedMpRequest(dataId: string, requestId: string, ts = "1700000000", sign = secret) {
    const v1 = hmacSha256(sign, `id:${dataId};request-id:${requestId};ts:${ts};`, "hex");
    return {
      headers: new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }),
      url: new URL(`http://localhost/api/webhooks/mercadopago/t?data.id=${dataId}&type=payment`),
      rawBody: JSON.stringify({ type: "payment", data: { id: dataId } }),
    };
  }

  it("valida x-signature según la documentación oficial", () => {
    const gw = new MercadoPagoGateway("TEST-token", secret);
    expect(gw.parseWebhook(signedMpRequest("123456", "req-1")).signatureValid).toBe(true);
    expect(
      gw.parseWebhook(signedMpRequest("123456", "req-1", "1700000000", "otro-secreto")).signatureValid,
    ).toBe(false);
    const tampered = signedMpRequest("123456", "req-1");
    tampered.url.searchParams.set("data.id", "999");
    expect(gw.parseWebhook(tampered).signatureValid).toBe(false);
    expect(
      new MercadoPagoGateway("TEST-token", undefined).parseWebhook(signedMpRequest("1", "r")).signatureValid,
    ).toBe(false);
  });

  it("aprueba solo tras consultar el pago en la API; conciliación sin webhook", async () => {
    await resetDb();
    const f = await createFixture({ paymentPolicy: "FULL_REQUIRED" });
    const apiState = new Map<string, { status: string; amount: number; ref: string }>();
    class TestMp extends MercadoPagoGateway {
      override async createCheckout(input: { paymentId: string }) {
        return {
          checkoutId: `pref-${input.paymentId}`,
          checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=test",
        };
      }
      override async fetchPayment(id: string) {
        const s = apiState.get(id)!;
        return {
          externalPaymentId: id,
          externalReference: s.ref,
          status: s.status === "approved" ? ("APPROVED" as const) : ("PENDING" as const),
          rawStatus: s.status,
          amount: s.amount,
          currency: "CLP",
          refundedAmount: 0,
          updatedAt: new Date(),
        };
      }
      override async findByReference(ref: string) {
        const entry = [...apiState.entries()].find(([, v]) => v.ref === ref);
        return entry ? this.fetchPayment(entry[0]) : null;
      }
    }
    setGatewayOverride(() => new TestMp("TEST-token", secret));

    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "12:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    const { paymentId } = await startCheckout(f.tenantId, r.appointment.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).amount).toBe(15000);

    // El webhook dice "payment 555" pero la API aún lo informa pendiente → no se confirma
    apiState.set("555", { status: "pending", amount: 15000, ref: paymentId });
    await handlePaymentWebhook("MERCADOPAGO", f.tenantId, signedMpRequest("555", "req-a"));
    expect((await db.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe(
      "PENDING_PAYMENT",
    );

    // Conciliación: el pago se aprobó y el webhook nunca llegó
    apiState.set("555", { status: "approved", amount: 15000, ref: paymentId });
    expect(await reconcilePayment(f.tenantId, paymentId)).toBe("approved:confirmed");
    expect((await db.appointment.findUniqueOrThrow({ where: { id: r.appointment.id } })).status).toBe(
      "CONFIRMED",
    );
  });

  it("no inicia checkout para un hold ya vencido", async () => {
    const f = await createFixture({ paymentPolicy: "DEPOSIT_REQUIRED" });
    const r = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "15:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await db.appointment.update({
      where: { id: r.appointment.id },
      data: { holdExpiresAt: addMinutes(new Date(), -1) },
    });
    await expect(startCheckout(f.tenantId, r.appointment.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

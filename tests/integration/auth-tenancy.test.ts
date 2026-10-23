import { beforeAll, describe, expect, it } from "vitest";
import {
  createBooking,
  getAppointmentDetail,
  listAppointments,
  transitionAppointment,
} from "@/modules/booking";
import { getCustomerDetail, listCustomers } from "@/modules/crm";
import {
  acceptInvitation,
  can,
  inviteMember,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  resolveSession,
  revokeAllSessions,
  updateMember,
} from "@/modules/identity";
import { sendManualMessage } from "@/modules/messaging";
import { saveService } from "@/modules/catalog";
import { getIntegration, saveIntegration } from "@/modules/tenancy";
import { db } from "@/shared/db";
import { bookingInput, createFixture, ctxFor, futureDate, resetDb, santiagoIso } from "../helpers";

describe("autenticación administrativa", () => {
  beforeAll(resetDb);

  it("login, sesión válida y logout", async () => {
    const f = await createFixture();
    const owner = await db.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    const { token } = await login({
      email: owner.email.toUpperCase(),
      password: "password123",
      ip: "1.1.1.1",
    });
    const ctx = await resolveSession(token);
    expect(ctx?.tenantId).toBe(f.tenantId);
    expect(ctx?.role).toBe("OWNER");
    // El token no se guarda en claro
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0);
    await logout(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("credenciales inválidas y bloqueo tras intentos fallidos", async () => {
    const f = await createFixture();
    const owner = await db.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    await expect(login({ email: "noexiste@test.local", password: "x", ip: "2.2.2.2" })).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
    for (let i = 0; i < 5; i++) {
      await expect(
        login({ email: owner.email, password: "mala-clave", ip: "2.2.2.3" }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    // Bloqueada: ni la contraseña correcta entra
    await expect(login({ email: owner.email, password: "password123", ip: "2.2.2.4" })).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
    const u = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("sesión expirada y revocada", async () => {
    const f = await createFixture();
    const owner = await db.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    const a = await login({ email: owner.email, password: "password123", ip: "3.3.3.1" });
    const b = await login({ email: owner.email, password: "password123", ip: "3.3.3.1" });
    await db.session.updateMany({ where: { userId: owner.id }, data: {} });
    const sessions = await db.session.findMany({
      where: { userId: owner.id },
      orderBy: { createdAt: "asc" },
    });
    await db.session.update({
      where: { id: sessions[0]!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).not.toBeNull();
    await revokeAllSessions(owner.id);
    expect(await resolveSession(b.token)).toBeNull();
  });

  it("recuperación de contraseña: token de un solo uso e invalida sesiones", async () => {
    const f = await createFixture();
    const owner = await db.user.findUniqueOrThrow({ where: { id: f.ownerId } });
    const session = await login({ email: owner.email, password: "password123", ip: "4.4.4.4" });
    let sentUrl = "";
    await requestPasswordReset(owner.email, "4.4.4.4", async (m) => {
      sentUrl = /https?:\/\/\S+/.exec(m.text)![0];
    });
    const token = new URL(sentUrl).searchParams.get("token")!;
    await resetPassword(token, "nuevaClave2026");
    await expect(resetPassword(token, "otraClave2026")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await resolveSession(session.token)).toBeNull();
    await expect(
      login({ email: owner.email, password: "nuevaClave2026", ip: "4.4.4.5" }),
    ).resolves.toBeTruthy();
    // Correo inexistente: no revela nada ni falla
    await expect(
      requestPasswordReset("nadie@test.local", "4.4.4.4", async () => {
        throw new Error("no debería enviarse");
      }),
    ).resolves.toBeUndefined();
  });

  it("invitaciones: un solo uso, rol asignado", async () => {
    const f = await createFixture();
    const { url } = await inviteMember(f.ctx, { email: "recep@test.local", role: "RECEPTIONIST" });
    const token = new URL(url).searchParams.get("token")!;
    await acceptInvitation(token, { name: "Recepción", password: "recepcion2026" });
    await expect(acceptInvitation(token, { name: "Otra", password: "recepcion2026" })).rejects.toThrow();
    const m = await db.membership.findFirstOrThrow({
      where: { tenantId: f.tenantId, user: { email: "recep@test.local" } },
    });
    expect(m.role).toBe("RECEPTIONIST");
  });

  it("no se puede dejar la barbería sin dueño", async () => {
    const f = await createFixture();
    const owner = await db.membership.findFirstOrThrow({ where: { tenantId: f.tenantId, role: "OWNER" } });
    const other = await db.user.create({
      data: { email: `admin-${Date.now()}@t.local`, name: "Admin", passwordHash: "x" },
    });
    await db.membership.create({ data: { tenantId: f.tenantId, userId: other.id, role: "OWNER" } });
    const t = await db.tenant.findUniqueOrThrow({ where: { id: f.tenantId } });
    const otherCtx = ctxFor(other.id, t, "OWNER");
    await updateMember(otherCtx, owner.id, { role: "ADMIN" });
    const ownerCtx = ctxFor(owner.userId, t, "ADMIN");
    const otherMembership = await db.membership.findFirstOrThrow({
      where: { tenantId: f.tenantId, userId: other.id },
    });
    await expect(
      updateMember({ ...ownerCtx, role: "OWNER" }, otherMembership.id, { role: "ADMIN" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("permisos por rol", () => {
  it("matriz RBAC", () => {
    expect(can("OWNER", "payments.refund")).toBe(true);
    expect(can("ADMIN", "payments.refund")).toBe(false);
    expect(can("RECEPTIONIST", "appointments.manage")).toBe(true);
    expect(can("RECEPTIONIST", "catalog.manage")).toBe(false);
    expect(can("BARBER", "customers.view")).toBe(false);
    expect(can("BARBER", "barber.portal")).toBe(true);
  });

  it("recepción no puede editar el catálogo; barbero solo ve sus citas", async () => {
    await resetDb();
    const f = await createFixture();
    const t = await db.tenant.findUniqueOrThrow({ where: { id: f.tenantId } });
    const recep = ctxFor(f.ownerId, t, "RECEPTIONIST");
    await expect(
      saveService(recep, { name: "Hack", priceAmount: 1, durationMinutes: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const date = futureDate(2);
    const a = await createBooking(f.tenantId, bookingInput(f, santiagoIso(date, "11:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await createBooking(
      f.tenantId,
      bookingInput(f, santiagoIso(date, "11:00"), {
        barberId: f.barberIds[1],
        customer: { name: "Otro", phone: "+56987654321" },
      }),
      { source: "WEB", actor: { type: "CUSTOMER" } },
    );
    const barberCtx = ctxFor(f.ownerId, t, "BARBER", f.barberIds[0]);
    const mine = await listAppointments(barberCtx, {
      from: new Date(0),
      to: new Date(8.64e15),
      barberId: f.barberIds[1],
    });
    expect(mine.every((x) => x.barberId === f.barberIds[0])).toBe(true);
    expect(mine).toHaveLength(1);
    await expect(listCustomers(barberCtx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getAppointmentDetail(barberCtx, a.appointment.id)).id).toBe(a.appointment.id);
  });
});

describe("aislamiento entre barberías", () => {
  it("un admin de A no puede leer ni operar datos de B", async () => {
    await resetDb();
    const a = await createFixture();
    const b = await createFixture();
    const date = futureDate(2);
    const bookingB = await createBooking(b.tenantId, bookingInput(b, santiagoIso(date, "12:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });

    await expect(getAppointmentDetail(a.ctx, bookingB.appointment.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getCustomerDetail(a.ctx, bookingB.appointment.customerId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      transitionAppointment(a.tenantId, bookingB.appointment.id, "cancel", { actor: { type: "STAFF" } }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await listAppointments(a.ctx, { from: new Date(0), to: new Date(8.64e15) })).toHaveLength(0);
    // No se pueden enviar mensajes a contactos de otra barbería
    await expect(
      sendManualMessage(a.ctx, {
        customerId: bookingB.appointment.customerId,
        channel: "WHATSAPP",
        body: "hola",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // No se pueden asignar barberos ni sucursales de otra barbería a un servicio propio
    await expect(
      saveService(a.ctx, {
        name: "Mixto",
        priceAmount: 1000,
        durationMinutes: 30,
        barberIds: [b.barberIds[0]],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // Ni reservar en A usando la sucursal/servicio de B
    await expect(
      createBooking(a.tenantId, bookingInput(b, santiagoIso(date, "13:00")), {
        source: "WEB",
        actor: { type: "CUSTOMER" },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("la BD impide citas que mezclen entidades de dos barberías (FK compuestas)", async () => {
    const a = await createFixture();
    const b = await createFixture();
    const date = futureDate(2);
    const r = await createBooking(a.tenantId, bookingInput(a, santiagoIso(date, "12:00")), {
      source: "WEB",
      actor: { type: "CUSTOMER" },
    });
    await expect(
      db.appointment.update({ where: { id: r.appointment.id }, data: { barberId: b.barberIds[0] } as never }),
    ).rejects.toThrow();
  });

  it("los secretos de integraciones se cifran y no se mezclan", async () => {
    const a = await createFixture();
    const b = await createFixture();
    await saveIntegration(a.ctx, "MERCADOPAGO", {
      enabled: true,
      secrets: { accessToken: "APP_USR-a", webhookSecret: "sec-a" },
    });
    await saveIntegration(b.ctx, "MERCADOPAGO", { enabled: true, secrets: { accessToken: "APP_USR-b" } });
    const row = await db.tenantIntegration.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    expect(row.secretsEncrypted).not.toContain("APP_USR-a");
    expect((await getIntegration(a.tenantId, "MERCADOPAGO"))!.secrets.accessToken).toBe("APP_USR-a");
    expect((await getIntegration(b.tenantId, "MERCADOPAGO"))!.secrets.accessToken).toBe("APP_USR-b");
    // Guardar vacío conserva el secreto anterior
    await saveIntegration(a.ctx, "MERCADOPAGO", { enabled: true, secrets: { accessToken: "" } });
    expect((await getIntegration(a.tenantId, "MERCADOPAGO"))!.secrets.accessToken).toBe("APP_USR-a");
    // Un número de WhatsApp no puede vincularse a dos barberías
    await saveIntegration(a.ctx, "WHATSAPP", { enabled: true, externalAccountId: "123456" });
    await expect(
      saveIntegration(b.ctx, "WHATSAPP", { enabled: true, externalAccountId: "123456" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

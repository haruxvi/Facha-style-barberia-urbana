"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { Channel, ConsentPurpose, Role } from "@/generated/prisma/enums";
import { updateAutomationRule } from "@/modules/automation";
import {
  assertCanOperate,
  createBooking,
  rescheduleAppointment,
  revokeManageToken,
  transitionAppointment,
  type TransitionName,
} from "@/modules/booking";
import { saveBarber, saveService, updateOwnBarberProfile } from "@/modules/catalog";
import { anonymizeCustomer, setConsentAsStaff, updateCustomer } from "@/modules/crm";
import {
  acceptInvitation,
  changePassword,
  clearSessionCookie,
  createTenant,
  inviteMember,
  login,
  logout,
  requestMeta,
  requestPasswordReset,
  requireAuthOrThrow,
  resetPassword,
  revokeInvitation,
  setSessionCookie,
  switchTenant,
  updateMember,
} from "@/modules/identity";
import { retryNotification, saveTemplate, sendManualMessage, sendPlatformEmail } from "@/modules/messaging";
import { reconcilePaymentAsStaff, refundPayment } from "@/modules/payments";
import { addScheduleException, removeScheduleException, setWeeklyHours } from "@/modules/scheduling";
import { createQrCampaign, saveBranch, saveIntegration, updateTenantSettings } from "@/modules/tenancy";
import { replyToConversation, resolveHandoff } from "@/modules/whatsapp";
import { bool, list, optStr, runAction, str, type ActionResult } from "@/server/actions";
import { drainSoon } from "@/server/worker";
import { AppError } from "@/shared/errors";

const staffActor = (userId: string) => ({ type: "STAFF" as const, userId });

// ───────────── Sesión ─────────────

export async function loginAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const meta = await requestMeta();
    const { token, expiresAt } = await login({
      email: str(fd, "email"),
      password: str(fd, "password"),
      ...meta,
    });
    await setSessionCookie(token, expiresAt);
  });
  // El panel redirige a los barberos a su portal según su rol.
  if (result?.ok) redirect("/admin");
  return result;
}

export async function logoutAction() {
  const token = await clearSessionCookie();
  if (token) await logout(token);
  redirect("/admin/login");
}

export async function forgotPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { ip } = await requestMeta();
    await requestPasswordReset(str(fd, "email"), ip, sendPlatformEmail);
    return "Si el correo existe, te enviamos un enlace para restablecer la contraseña.";
  });
}

export async function resetPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    if (str(fd, "password") !== str(fd, "confirm"))
      throw new AppError("VALIDATION", "Las contraseñas no coinciden");
    await resetPassword(str(fd, "token"), str(fd, "password"));
  });
  if (result?.ok) redirect("/admin/login?reset=1");
  return result;
}

export async function acceptInvitationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    await acceptInvitation(str(fd, "token"), {
      name: optStr(fd, "name") ?? undefined,
      password: str(fd, "password"),
    });
  });
  if (result?.ok) redirect("/admin/login?invitacion=1");
  return result;
}

export async function switchTenantAction(fd: FormData) {
  const ctx = await requireAuthOrThrow();
  await switchTenant(ctx, str(fd, "tenantId"));
  redirect("/admin");
}

export async function changePasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow();
    if (str(fd, "next") !== str(fd, "confirm"))
      throw new AppError("VALIDATION", "Las contraseñas no coinciden");
    await changePassword(ctx, str(fd, "current"), str(fd, "next"));
    return "Contraseña actualizada. Se cerraron tus otras sesiones.";
  });
}

// ───────────── Reservas ─────────────

export async function appointmentTransitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const name = str(fd, "transition") as TransitionName;
    if (!["confirm", "cancel", "check_in", "complete", "no_show"].includes(name))
      throw new AppError("VALIDATION", "Acción inválida");
    const ctx = await requireAuthOrThrow();
    const id = str(fd, "appointmentId");
    await assertCanOperate(ctx, id, ["check_in", "complete", "no_show"].includes(name));
    await transitionAppointment(ctx.tenantId, id, name, {
      actor: staffActor(ctx.userId),
      reason: optStr(fd, "reason"),
    });
    after(drainSoon);
    revalidatePath("/admin", "layout");
    revalidatePath("/barber", "layout");
    return "Reserva actualizada";
  });
}

export async function rescheduleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("appointments.manage");
    await rescheduleAppointment(
      ctx.tenantId,
      str(fd, "appointmentId"),
      { startsAt: str(fd, "startsAt"), barberId: optStr(fd, "barberId") },
      { actor: staffActor(ctx.userId) },
    );
    after(drainSoon);
    revalidatePath("/admin", "layout");
    return "Reserva reprogramada";
  });
}

export async function revokeLinkAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("appointments.manage");
    await revokeManageToken(ctx.tenantId, str(fd, "appointmentId"), staffActor(ctx.userId));
    revalidatePath("/admin/reservas");
    return "Enlace revocado. Los mensajes nuevos llevarán un enlace nuevo.";
  });
}

export async function createManualBookingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string | null = null;
  const result = await runAction(async () => {
    const ctx = await requireAuthOrThrow("appointments.manage");
    const r = await createBooking(
      ctx.tenantId,
      {
        branchId: str(fd, "branchId"),
        serviceId: str(fd, "serviceId"),
        barberId: optStr(fd, "barberId"),
        startsAt: str(fd, "startsAt"),
        customer: { name: str(fd, "name"), phone: str(fd, "phone"), email: optStr(fd, "email") },
        consents: {
          whatsapp: bool(fd, "consentWhatsapp"),
          email: bool(fd, "consentEmail"),
          marketing: false,
        },
        acceptTerms: true,
        customerNotes: optStr(fd, "notes"),
        idempotencyKey: str(fd, "idempotencyKey") || undefined,
      },
      { source: "ADMIN", actor: staffActor(ctx.userId) },
    );
    id = r.appointment.id;
    after(drainSoon);
  });
  if (id) redirect(`/admin/reservas/${id}`);
  return result;
}

// ───────────── Agenda: bloqueos y horarios ─────────────

export async function addExceptionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow();
    await addScheduleException(ctx, {
      barberId: optStr(fd, "barberId"),
      branchId: optStr(fd, "branchId"),
      type: str(fd, "type") === "EXTRA_HOURS" ? "EXTRA_HOURS" : "TIME_OFF",
      date: str(fd, "date"),
      endDate: optStr(fd, "endDate") ?? undefined,
      start: str(fd, "start") || "00:00",
      end: str(fd, "end") || "24:00",
      reason: optStr(fd, "reason"),
    });
    revalidatePath("/admin", "layout");
    revalidatePath("/barber", "layout");
    return "Bloqueo registrado";
  });
}

export async function removeExceptionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow();
    await removeScheduleException(ctx, str(fd, "id"));
    revalidatePath("/admin", "layout");
    revalidatePath("/barber", "layout");
    return "Eliminado";
  });
}

export async function saveWeeklyHoursAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("barbers.manage");
    const rows: { weekday: number; start: string; end: string }[] = [];
    for (let wd = 0; wd < 7; wd++) {
      for (const slot of [1, 2]) {
        const start = str(fd, `d${wd}_s${slot}_start`);
        const end = str(fd, `d${wd}_s${slot}_end`);
        if (start && end) rows.push({ weekday: wd, start, end });
      }
    }
    await setWeeklyHours(ctx, str(fd, "barberId"), str(fd, "branchId"), rows);
    revalidatePath(`/admin/barberos/${str(fd, "barberId")}`);
    return "Horario guardado";
  });
}

// ───────────── Catálogo y estructura ─────────────

export async function saveServiceAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("catalog.manage");
    await saveService(ctx, {
      id: optStr(fd, "id") ?? undefined,
      name: str(fd, "name"),
      description: optStr(fd, "description"),
      priceAmount: str(fd, "priceAmount") as unknown as number,
      durationMinutes: str(fd, "durationMinutes") as unknown as number,
      bufferMinutes: (str(fd, "bufferMinutes") || "0") as unknown as number,
      sortOrder: (str(fd, "sortOrder") || "0") as unknown as number,
      active: bool(fd, "active"),
      branchIds: list(fd, "branchIds"),
      barberIds: list(fd, "barberIds"),
    });
    revalidatePath("/admin/servicios");
    return "Servicio guardado";
  });
}

export async function saveBarberAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const ctx = await requireAuthOrThrow("barbers.manage");
    const id = optStr(fd, "id");
    const saved = await saveBarber(ctx, {
      id: id ?? undefined,
      displayName: str(fd, "displayName"),
      bio: optStr(fd, "bio"),
      photoUrl: optStr(fd, "photoUrl"),
      active: bool(fd, "active"),
      commissionBps: Math.round(Number(str(fd, "commissionPercent") || "0") * 100),
      branchIds: list(fd, "branchIds"),
      serviceIds: list(fd, "serviceIds"),
    });
    if (!id) createdId = saved;
    revalidatePath("/admin/barberos", "layout");
    return "Barbero guardado";
  });
  if (createdId) redirect(`/admin/barberos/${createdId}`);
  return result;
}

export async function saveBranchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("branches.manage");
    await saveBranch(ctx, {
      id: optStr(fd, "id") ?? undefined,
      name: str(fd, "name"),
      slug: str(fd, "slug"),
      address: optStr(fd, "address"),
      phone: optStr(fd, "phone"),
      timezone: str(fd, "timezone") || ctx.timezone,
      active: bool(fd, "active"),
    });
    revalidatePath("/admin/sucursales");
    return "Sucursal guardada";
  });
}

// ───────────── Clientes ─────────────

export async function updateCustomerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("customers.manage");
    await updateCustomer(ctx, str(fd, "customerId"), {
      name: str(fd, "name"),
      email: optStr(fd, "email"),
      notes: optStr(fd, "notes"),
      preferences: optStr(fd, "preferences"),
    });
    revalidatePath(`/admin/clientes/${str(fd, "customerId")}`);
    return "Cliente actualizado";
  });
}

export async function setConsentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("customers.manage");
    await setConsentAsStaff(
      ctx,
      str(fd, "customerId"),
      str(fd, "channel") as Channel,
      str(fd, "purpose") as ConsentPurpose,
      str(fd, "granted") === "true",
    );
    revalidatePath(`/admin/clientes/${str(fd, "customerId")}`);
    return "Consentimiento actualizado";
  });
}

export async function anonymizeCustomerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const ctx = await requireAuthOrThrow("customers.manage");
    await anonymizeCustomer(ctx, str(fd, "customerId"));
  });
  if (result?.ok) redirect("/admin/clientes");
  return result;
}

// ───────────── Mensajes y automatizaciones ─────────────

export async function sendManualMessageAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("messages.send");
    const r = await sendManualMessage(ctx, {
      customerId: str(fd, "customerId"),
      appointmentId: optStr(fd, "appointmentId"),
      channel: str(fd, "channel") === "EMAIL" ? "EMAIL" : "WHATSAPP",
      subject: optStr(fd, "subject"),
      body: str(fd, "body"),
    });
    revalidatePath("/admin/mensajes");
    return r.status === "SENT"
      ? "Mensaje enviado"
      : r.status === "QUEUED"
        ? "En cola: se reintentará"
        : `Estado: ${r.status}`;
  });
}

export async function retryNotificationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("messages.send");
    const status = await retryNotification(ctx, str(fd, "id"));
    revalidatePath("/admin/mensajes");
    return `Estado: ${status}`;
  });
}

export async function replyConversationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("messages.send");
    await replyToConversation(ctx, str(fd, "conversationId"), { body: str(fd, "body") });
    revalidatePath("/admin/mensajes");
    return "Enviado";
  });
}

export async function resolveHandoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("messages.send");
    await resolveHandoff(ctx, str(fd, "conversationId"));
    revalidatePath("/admin/mensajes");
    return "Conversación devuelta al bot";
  });
}

export async function saveTemplateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("automations.manage");
    await saveTemplate(ctx, {
      id: optStr(fd, "id") ?? undefined,
      key: str(fd, "key"),
      channel: str(fd, "channel") === "EMAIL" ? "EMAIL" : "WHATSAPP",
      name: str(fd, "name"),
      subject: optStr(fd, "subject"),
      body: str(fd, "body"),
      waTemplateName: optStr(fd, "waTemplateName"),
      waLanguage: optStr(fd, "waLanguage") ?? "es",
      active: bool(fd, "active"),
    });
    revalidatePath("/admin/automatizaciones");
    return "Plantilla guardada";
  });
}

export async function updateRuleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("automations.manage");
    const unit = str(fd, "unit");
    const factor = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
    await updateAutomationRule(ctx, str(fd, "ruleId"), {
      active: bool(fd, "active"),
      offsetMinutes: Math.round(Number(str(fd, "offset") || "0") * factor),
      templateKey: str(fd, "templateKey"),
    });
    revalidatePath("/admin/automatizaciones");
    return "Guardado";
  });
}

// ───────────── Pagos ─────────────

export async function refundAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("payments.refund");
    const amount = optStr(fd, "amount");
    await refundPayment(
      ctx,
      str(fd, "paymentId"),
      amount ? Number(amount) : undefined,
      optStr(fd, "reason") ?? undefined,
    );
    revalidatePath("/admin/pagos");
    return "Reembolso registrado";
  });
}

export async function reconcileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("payments.view");
    const r = await reconcilePaymentAsStaff(ctx, str(fd, "paymentId"));
    revalidatePath("/admin/pagos");
    return `Conciliado con el proveedor: ${r}`;
  });
}

// ───────────── Configuración ─────────────

export async function saveSettingsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("settings.manage");
    const num = (k: string) => str(fd, k) as unknown as number;
    await updateTenantSettings(ctx, {
      name: str(fd, "name"),
      description: optStr(fd, "description"),
      publicPhone: optStr(fd, "publicPhone"),
      instagram: optStr(fd, "instagram"),
      timezone: str(fd, "timezone"),
      currency: str(fd, "currency"),
      paymentPolicy: str(fd, "paymentPolicy") as "NONE",
      depositAmount: num("depositAmount"),
      holdMinutes: num("holdMinutes"),
      slotIntervalMinutes: num("slotIntervalMinutes"),
      minNoticeMinutes: num("minNoticeMinutes"),
      bookingHorizonDays: num("bookingHorizonDays"),
      cancellationWindowMinutes: Number(str(fd, "cancellationHours") || "0") * 60,
      rescheduleWindowMinutes: Number(str(fd, "rescheduleHours") || "0") * 60,
      bookingTerms: optStr(fd, "bookingTerms"),
    });
    revalidatePath("/admin", "layout");
    return "Configuración guardada";
  });
}

export async function saveIntegrationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("integrations.manage");
    const kind = str(fd, "kind") === "WHATSAPP" ? "WHATSAPP" : "MERCADOPAGO";
    await saveIntegration(ctx, kind, {
      enabled: bool(fd, "enabled"),
      externalAccountId: optStr(fd, "externalAccountId"),
      secrets: { accessToken: str(fd, "accessToken"), webhookSecret: str(fd, "webhookSecret") },
    });
    revalidatePath("/admin/configuracion");
    return "Integración guardada (los secretos se guardan cifrados)";
  });
}

export async function createQrCampaignAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("settings.manage");
    await createQrCampaign(ctx, { code: str(fd, "code"), label: str(fd, "label") });
    revalidatePath("/admin/configuracion");
    return "Campaña creada";
  });
}

export async function createTenantAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let tenantId: string | null = null;
  const result = await runAction(async () => {
    const ctx = await requireAuthOrThrow("settings.manage");
    const t = await createTenant({
      name: str(fd, "name"),
      slug: str(fd, "slug"),
      ownerUserId: ctx.userId,
      timezone: ctx.timezone,
      currency: ctx.currency,
    });
    await switchTenant(
      {
        ...ctx,
        memberships: [...ctx.memberships, { tenantId: t.id, tenantName: str(fd, "name"), role: "OWNER" }],
      },
      t.id,
    );
    tenantId = t.id;
  });
  if (tenantId) redirect("/admin/sucursales");
  return result;
}

// ───────────── Usuarios ─────────────

export async function inviteMemberAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("users.manage");
    const { url } = await inviteMember(
      ctx,
      { email: str(fd, "email"), role: str(fd, "role") as Role },
      sendPlatformEmail,
    );
    revalidatePath("/admin/usuarios");
    return `Invitación creada. Si el correo no llega, comparte este enlace (un solo uso, 7 días): ${url}`;
  });
}

export async function updateMemberAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("users.manage");
    await updateMember(ctx, str(fd, "membershipId"), {
      role: (optStr(fd, "role") as Role | null) ?? undefined,
      active: fd.has("active") ? bool(fd, "active") : undefined,
      barberId: fd.has("barberId") ? optStr(fd, "barberId") : undefined,
    });
    revalidatePath("/admin/usuarios");
    return "Miembro actualizado";
  });
}

export async function revokeInvitationAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("users.manage");
    await revokeInvitation(ctx, str(fd, "invitationId"));
    revalidatePath("/admin/usuarios");
    return "Invitación revocada";
  });
}

// ───────────── Portal del barbero ─────────────

export async function updateOwnProfileAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requireAuthOrThrow("barber.portal");
    await updateOwnBarberProfile(ctx, { bio: optStr(fd, "bio"), photoUrl: optStr(fd, "photoUrl") });
    revalidatePath("/barber/perfil");
    return "Perfil actualizado";
  });
}

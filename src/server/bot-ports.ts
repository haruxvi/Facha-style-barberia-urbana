import { upcomingAppointmentsForVerifiedPhone, createManageToken } from "@/modules/booking";
import { getBookableService, listPublicBarbers, listPublicServices } from "@/modules/catalog";
import { revokeWhatsAppConsentByPhone } from "@/modules/crm";
import { loadAvailability } from "@/modules/scheduling";
import type { BotPorts, BotPortsFactory } from "@/modules/whatsapp";
import { db } from "@/shared/db";
import { appUrl } from "@/shared/env";
import { AppError } from "@/shared/errors";
import { formatMoney } from "@/shared/money";
import { addDays, formatDateTime, formatLocalDate, todayIn } from "@/shared/time";
import { bookPublicly } from "./public-booking";

/** Conecta el bot con los servicios de dominio. El teléfono es el remitente verificado por WhatsApp. */
export const botPortsFactory: BotPortsFactory = async ({ tenantId, waPhone }) => {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const tz = tenant.timezone;
  const manageUrl = (id: string, version: number) =>
    appUrl(`/reservas/gestionar/${createManageToken(id, version)}`);

  const ports: BotPorts = {
    tenantName: tenant.name,
    formatMoney: (n) => formatMoney(n, tenant.currency),
    formatSlot: (d) => formatDateTime(d, tz),
    formatDay: (date) => formatLocalDate(date),
    upcomingDates: (days) => Array.from({ length: days }, (_, i) => addDays(todayIn(tz), i)),
    listBranches: () =>
      db.branch.findMany({
        where: { tenantId, active: true },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
    listServices: (branchId) => listPublicServices(tenantId, branchId),
    listBarbers: (branchId, serviceId) => listPublicBarbers(tenantId, branchId, serviceId),
    getSlots: async (branchId, serviceId, barberId, date) => {
      const service = await getBookableService(tenantId, branchId, serviceId);
      if (!service) return [];
      return (await loadAvailability({ tenantId, branchId, service, barberId, date })).slots;
    },
    knownCustomerName: async () => {
      const c = await db.customer.findUnique({
        where: { tenantId_phoneE164: { tenantId, phoneE164: waPhone } },
      });
      return c && !c.anonymizedAt ? c.name : null;
    },
    createBooking: async (input) => {
      try {
        const r = await bookPublicly(
          tenantId,
          {
            branchId: input.branchId,
            serviceId: input.serviceId,
            barberId: input.barberId,
            startsAt: input.startsAt,
            customer: { name: input.name, phone: waPhone, email: null },
            consents: { whatsapp: true, email: false, marketing: false },
            acceptTerms: true,
            payOnline: true,
            idempotencyKey: input.idempotencyKey,
          },
          "WHATSAPP",
        );
        const appt = await db.appointment.findUniqueOrThrow({ where: { id: r.appointmentId } });
        return {
          ok: true,
          status: r.status as "CONFIRMED" | "PENDING_PAYMENT",
          manageUrl: manageUrl(appt.id, appt.manageTokenVersion),
          paymentUrl: r.checkoutUrl ?? undefined,
          amountDue: r.amountDue,
          holdMinutes: r.holdMinutes,
        };
      } catch (err) {
        if (err instanceof AppError && err.code === "SLOT_UNAVAILABLE") {
          return { ok: false, reason: "slot_unavailable", message: err.message };
        }
        if (err instanceof AppError) return { ok: false, reason: "error", message: err.message };
        throw err;
      }
    },
    upcoming: async () => {
      const list = await upcomingAppointmentsForVerifiedPhone(tenantId, waPhone);
      return list.map((a) => ({
        label: `${a.serviceName} — ${formatDateTime(a.startsAt, a.branch.timezone)} con ${a.barber.displayName}${a.status === "PENDING_PAYMENT" ? " (pendiente de pago)" : ""}`,
        manageUrl: manageUrl(a.id, a.manageTokenVersion),
      }));
    },
    revokeConsent: async () => {
      await revokeWhatsAppConsentByPhone(tenantId, waPhone);
    },
  };
  return ports;
};

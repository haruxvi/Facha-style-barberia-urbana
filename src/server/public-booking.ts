import { createBooking, paymentRequirementFor, type BookingInput } from "@/modules/booking";
import { availableProvider, startCheckout } from "@/modules/payments";
import { getPublicTenant } from "@/modules/tenancy";
import type { BookingSource } from "@/generated/prisma/enums";
import { db } from "@/shared/db";
import { AppError, notFound } from "@/shared/errors";
import { logger } from "@/shared/logger";

/**
 * Caso de uso "reservar" para canales públicos (web y WhatsApp).
 * Orquesta booking + payments sin acoplar los módulos entre sí.
 */
export async function bookPublicly(
  tenantId: string,
  input: BookingInput,
  source: Extract<BookingSource, "WEB" | "WHATSAPP">,
): Promise<{
  appointmentId: string;
  manageToken: string;
  status: string;
  checkoutUrl: string | null;
  amountDue: number;
  holdMinutes: number;
}> {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  // Si la reserva va a exigir pago online, comprobar ANTES que hay proveedor (evita holds imposibles de pagar).
  const service = await db.service.findFirst({ where: { id: input.serviceId, tenantId } });
  if (service) {
    const { requirement } = paymentRequirementFor(
      tenant.paymentPolicy,
      service.priceAmount,
      tenant.depositAmount,
      !!input.payOnline,
    );
    if (requirement !== "NONE" && !(await availableProvider(tenantId))) {
      if (tenant.paymentPolicy === "OPTIONAL") input = { ...input, payOnline: false };
      else
        throw new AppError(
          "CONFIG",
          "Las reservas online no están disponibles temporalmente. Contáctanos directamente.",
        );
    }
  }

  const result = await createBooking(tenantId, input, {
    source,
    actor: { type: source === "WEB" ? "CUSTOMER" : "BOT" },
  });
  let checkoutUrl: string | null = null;
  if (result.appointment.status === "PENDING_PAYMENT") {
    try {
      checkoutUrl = (await startCheckout(tenantId, result.appointment.id)).checkoutUrl;
    } catch (err) {
      // La reserva queda en hold; el cliente puede reintentar el pago desde la página de confirmación.
      logger.error("booking.checkout_failed", { appointmentId: result.appointment.id, error: err });
    }
  }
  return {
    appointmentId: result.appointment.id,
    manageToken: result.manageToken,
    status: result.appointment.status,
    checkoutUrl,
    amountDue: result.appointment.amountDue,
    holdMinutes: tenant.holdMinutes,
  };
}

export async function resolvePublicTenant(slug: string) {
  const tenant = await getPublicTenant(slug);
  if (!tenant) throw notFound("Barbería");
  return tenant;
}

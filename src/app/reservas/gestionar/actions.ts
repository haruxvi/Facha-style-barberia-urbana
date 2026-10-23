"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { getPublicAppointment, rescheduleAppointment, transitionAppointment } from "@/modules/booking";
import { getBookableService } from "@/modules/catalog";
import { startCheckout } from "@/modules/payments";
import { loadAvailability } from "@/modules/scheduling";
import { runAction, str, type ActionResult } from "@/server/actions";
import { bookingAccessFromCookies, manageSessionFromCookies } from "@/server/booking-cookie";
import { drainSoon } from "@/server/worker";
import { AppError } from "@/shared/errors";

/**
 * Acciones del cliente SIN login. Cada acción revalida el token de la cookie: la cookie solo
 * autoriza operar sobre SU reserva (cancelar, reprogramar, pagar), nada más.
 */
async function requireSession() {
  const s = await manageSessionFromCookies();
  if (!s)
    throw new AppError(
      "UNAUTHENTICATED",
      "Tu enlace expiró. Ábrelo de nuevo desde el mensaje que te enviamos.",
    );
  return s;
}

export async function cancelByCustomerAction(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await transitionAppointment(s.tenantId, s.appointmentId, "cancel", {
      actor: { type: "CUSTOMER" },
      reason: "Cancelada por el cliente",
      enforceCustomerPolicy: true,
    });
    after(drainSoon);
    return "Reserva cancelada";
  });
}

export async function slotsForRescheduleAction(
  date: string,
): Promise<{ startsAt: string }[] | { error: string }> {
  try {
    const s = await requireSession();
    const a = await getPublicAppointment(s.tenantId, s.appointmentId);
    if (!a || a.status !== "CONFIRMED") return { error: "Esta reserva no se puede reprogramar" };
    const service = await getBookableService(s.tenantId, a.branchId, a.serviceId);
    if (!service) return { error: "El servicio ya no está disponible" };
    const r = await loadAvailability({
      tenantId: s.tenantId,
      branchId: a.branchId,
      service: { id: a.serviceId, durationMinutes: a.durationMinutes, bufferMinutes: service.bufferMinutes },
      barberId: a.barberId,
      date,
      excludeAppointmentId: a.id,
    });
    return r.slots.map((x) => ({ startsAt: x.startsAt.toISOString() }));
  } catch (err) {
    return { error: err instanceof AppError ? err.message : "No pudimos cargar las horas" };
  }
}

export async function rescheduleByCustomerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const s = await requireSession();
    await rescheduleAppointment(
      s.tenantId,
      s.appointmentId,
      { startsAt: str(fd, "startsAt") },
      {
        actor: { type: "CUSTOMER" },
        enforceCustomerPolicy: true,
      },
    );
    after(drainSoon);
    return "Reserva reprogramada";
  });
}

export async function payPendingAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let url: string | null = null;
  const result = await runAction(async () => {
    const appointmentId = str(fd, "appointmentId");
    // Solo la reserva cuyo token tiene este navegador.
    const access = await bookingAccessFromCookies(appointmentId);
    if (!access)
      throw new AppError(
        "UNAUTHENTICATED",
        "Tu enlace expiró. Ábrelo de nuevo desde el mensaje que te enviamos.",
      );
    url = (await startCheckout(access.tenantId, appointmentId)).checkoutUrl;
  });
  if (url) redirect(url);
  return result;
}

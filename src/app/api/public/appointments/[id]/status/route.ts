import { NextResponse } from "next/server";
import { getPublicAppointment, verifyManageToken } from "@/modules/booking";
import { bookingAccessFromCookies } from "@/server/booking-cookie";
import { errorResponse } from "@/server/http";

/**
 * Estado de una reserva. Requiere el token de gestión (Authorization: Bearer) o la cookie de la reserva.
 * Conocer el id NO basta: sin token se responde 404 (no se revela si existe).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let tenantId: string | null = null;
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) {
      const check = await verifyManageToken(bearer);
      if (check.ok && check.appointmentId === id) tenantId = check.tenantId;
    } else {
      tenantId = (await bookingAccessFromCookies(id))?.tenantId ?? null;
    }
    if (!tenantId)
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Reserva no encontrada" } },
        { status: 404 },
      );
    const a = await getPublicAppointment(tenantId, id);
    if (!a)
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Reserva no encontrada" } },
        { status: 404 },
      );
    return NextResponse.json(
      {
        id: a.id,
        status: a.status,
        startsAt: a.startsAt,
        serviceName: a.serviceName,
        barber: a.barber.displayName,
        branch: a.branch.name,
        payment: a.payments[0] ? { status: a.payments[0].status, amount: a.payments[0].amount } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

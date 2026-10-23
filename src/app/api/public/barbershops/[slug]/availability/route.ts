import { NextResponse } from "next/server";
import { z } from "zod";
import { getBookableService } from "@/modules/catalog";
import { loadAvailability } from "@/modules/scheduling";
import { clientIp, errorResponse } from "@/server/http";
import { resolvePublicTenant } from "@/server/public-booking";
import { validation } from "@/shared/errors";
import { enforceRateLimit } from "@/shared/rate-limit";
import { parseInput } from "@/shared/validation";

const querySchema = z.object({
  branchId: z.uuid(),
  serviceId: z.uuid(),
  barberId: z.uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

/** Disponibilidad calculada por el servidor. Solo devuelve horas libres, nunca datos de otras citas. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await enforceRateLimit(`avail:${clientIp(req)}`, 120, 60);
    const { slug } = await params;
    const tenant = await resolvePublicTenant(slug);
    const sp = new URL(req.url).searchParams;
    const q = parseInput(querySchema, {
      branchId: sp.get("branchId"),
      serviceId: sp.get("serviceId"),
      barberId: sp.get("barberId") || null,
      date: sp.get("date"),
    });
    if (!tenant.branches.some((b) => b.id === q.branchId)) throw validation("Sucursal inválida");
    const service = await getBookableService(tenant.id, q.branchId, q.serviceId);
    if (!service) throw validation("Servicio no disponible");
    const result = await loadAvailability({
      tenantId: tenant.id,
      branchId: q.branchId,
      service,
      barberId: q.barberId,
      date: q.date,
    });
    return NextResponse.json(
      {
        timezone: result.timezone,
        slots: result.slots.map((s) => ({ startsAt: s.startsAt.toISOString(), barberIds: s.barberIds })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

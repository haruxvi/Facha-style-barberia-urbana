import { NextResponse } from "next/server";
import { listPublicBarbers, listPublicServices } from "@/modules/catalog";
import { errorResponse } from "@/server/http";
import { resolvePublicTenant } from "@/server/public-booking";
import { validation } from "@/shared/errors";

/** Catálogo de una sucursal: servicios con precio efectivo y barberos que los realizan. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const tenant = await resolvePublicTenant(slug);
    const branchId = new URL(req.url).searchParams.get("branchId") ?? tenant.branches[0]?.id;
    if (!branchId || !tenant.branches.some((b) => b.id === branchId)) throw validation("Sucursal inválida");
    const services = await listPublicServices(tenant.id, branchId);
    const withBarbers = await Promise.all(
      services.map(async (s) => ({ ...s, barbers: await listPublicBarbers(tenant.id, branchId, s.id) })),
    );
    return NextResponse.json(
      { branchId, services: withBarbers },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

import { NextResponse } from "next/server";
import { exportCustomerData } from "@/modules/crm";
import { requireAuthOrThrow } from "@/modules/identity";
import { errorResponse } from "@/server/http";

/** Exportación de datos de un cliente (derecho de acceso). Requiere permiso customers.manage. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuthOrThrow("customers.manage");
    const { id } = await params;
    const data = await exportCustomerData(ctx, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cliente-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

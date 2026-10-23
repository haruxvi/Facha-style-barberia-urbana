import { NextResponse } from "next/server";
import { requireAuthOrThrow } from "@/modules/identity";
import { renderQr } from "@/modules/tenancy";
import { errorResponse } from "@/server/http";

/** Descarga del QR de una campaña (SVG o PNG) de la barbería activa. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const ctx = await requireAuthOrThrow("settings.manage");
    const { code } = await params;
    const format = new URL(req.url).searchParams.get("formato") === "png" ? "png" : "svg";
    const qr = await renderQr(ctx, code, format);
    const body = typeof qr.body === "string" ? qr.body : new Uint8Array(qr.body);
    return new NextResponse(body, {
      headers: {
        "Content-Type": qr.contentType,
        "Content-Disposition": `attachment; filename="${qr.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

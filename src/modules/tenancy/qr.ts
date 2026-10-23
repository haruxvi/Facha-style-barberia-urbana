import QRCode from "qrcode";
import { z } from "zod";
import { assertCan, type AuthContext } from "@/modules/identity";
import { db, isUniqueViolation } from "@/shared/db";
import { appUrl } from "@/shared/env";
import { conflict, notFound } from "@/shared/errors";
import { parseInput } from "@/shared/validation";

/**
 * Los QR solo contienen la URL pública de la barbería + un código de campaña.
 * Nunca incluyen datos personales, tokens ni nada que otorgue permisos o cambie precios.
 */
export function publicBookingUrl(slug: string, campaign?: string | null): string {
  const url = new URL(appUrl(`/b/${slug}`));
  if (campaign) url.searchParams.set("c", campaign);
  return url.toString();
}

export async function listQrCampaigns(ctx: AuthContext) {
  const [campaigns, visits, bookings] = await Promise.all([
    db.qrCampaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "asc" } }),
    db.campaignVisit.groupBy({ by: ["campaign"], where: { tenantId: ctx.tenantId }, _sum: { visits: true } }),
    db.appointment.groupBy({
      by: ["campaign"],
      where: { tenantId: ctx.tenantId, campaign: { not: null }, status: { notIn: ["EXPIRED"] } },
      _count: { _all: true },
    }),
  ]);
  return campaigns.map((c) => ({
    ...c,
    url: publicBookingUrl(ctx.tenantSlug, c.code),
    visits: visits.find((v) => v.campaign === c.code)?._sum.visits ?? 0,
    bookings: bookings.find((b) => b.campaign === c.code)?._count._all ?? 0,
  }));
}

const campaignSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,40}$/, "Usa minúsculas, números y guiones"),
  label: z.string().trim().min(2).max(60),
});

export async function createQrCampaign(ctx: AuthContext, input: z.input<typeof campaignSchema>) {
  assertCan(ctx, "settings.manage");
  const data = parseInput(campaignSchema, input);
  try {
    await db.qrCampaign.create({ data: { ...data, tenantId: ctx.tenantId } });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Ya existe una campaña con ese código");
    throw err;
  }
}

export async function renderQr(
  ctx: AuthContext,
  code: string,
  format: "svg" | "png",
): Promise<{ body: string | Buffer; contentType: string; filename: string }> {
  const campaign = await db.qrCampaign.findFirst({ where: { tenantId: ctx.tenantId, code } });
  if (!campaign) throw notFound("Campaña");
  const url = publicBookingUrl(ctx.tenantSlug, campaign.code);
  const opts = {
    errorCorrectionLevel: "M" as const,
    margin: 2,
    color: { dark: "#111111", light: "#ffffff" },
  };
  const filename = `qr-${ctx.tenantSlug}-${campaign.code}.${format}`;
  if (format === "svg") {
    return {
      body: await QRCode.toString(url, { ...opts, type: "svg" }),
      contentType: "image/svg+xml",
      filename,
    };
  }
  return {
    body: await QRCode.toBuffer(url, { ...opts, type: "png", width: 1024 }),
    contentType: "image/png",
    filename,
  };
}

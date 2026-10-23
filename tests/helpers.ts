import type { Role } from "@/generated/prisma/enums";
import { createTenant, hashPassword, type AuthContext } from "@/modules/identity";
import { db } from "@/shared/db";
import { addDays, todayIn, zonedToUtc } from "@/shared/time";

/** Vacía todas las tablas de la BD de tests (nunca se ejecuta contra otra base: ver setup-env). */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("test")) throw new Error("resetDb solo en BD de tests");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let counter = 0;

export interface Fixture {
  tenantId: string;
  slug: string;
  branchId: string;
  barberIds: [string, string];
  serviceId: string;
  ownerId: string;
  ctx: AuthContext;
}

/**
 * Barbería de prueba: 1 sucursal (America/Santiago), 2 barberos de 10:00 a 20:00 todos los días,
 * corte de 30 min + 10 min de buffer a $15.000.
 */
export async function createFixture(
  opts: { paymentPolicy?: "NONE" | "DEPOSIT_REQUIRED" | "FULL_REQUIRED" | "OPTIONAL" } = {},
): Promise<Fixture> {
  counter++;
  const owner = await db.user.create({
    data: {
      email: `owner${counter}-${Date.now()}@test.local`,
      name: "Dueño Test",
      passwordHash: await hashPassword("password123"),
    },
  });
  const slug = `barberia-test-${counter}-${Date.now() % 100000}`;
  const tenant = await createTenant({ name: `Barbería Test ${counter}`, slug, ownerUserId: owner.id });
  await db.tenant.update({
    where: { id: tenant.id },
    data: {
      paymentPolicy: opts.paymentPolicy ?? "NONE",
      depositAmount: 5000,
      minNoticeMinutes: 0,
      slotIntervalMinutes: 15,
    },
  });
  const branch = await db.branch.create({
    data: { tenantId: tenant.id, slug: "centro", name: "Centro", timezone: "America/Santiago" },
  });
  const service = await db.service.create({
    data: { tenantId: tenant.id, name: "Corte", priceAmount: 15000, durationMinutes: 30, bufferMinutes: 10 },
  });
  await db.serviceBranch.create({
    data: { tenantId: tenant.id, serviceId: service.id, branchId: branch.id },
  });
  const barberIds: string[] = [];
  for (const name of ["Barbero A", "Barbero B"]) {
    const b = await db.barber.create({
      data: { tenantId: tenant.id, displayName: name, commissionBps: 4000 },
    });
    barberIds.push(b.id);
    await db.barberBranch.create({ data: { tenantId: tenant.id, barberId: b.id, branchId: branch.id } });
    await db.barberService.create({ data: { tenantId: tenant.id, barberId: b.id, serviceId: service.id } });
    await db.workingHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        tenantId: tenant.id,
        barberId: b.id,
        branchId: branch.id,
        weekday,
        startMinute: 600,
        endMinute: 1200,
      })),
    });
  }
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  return {
    tenantId: tenant.id,
    slug,
    branchId: branch.id,
    barberIds: barberIds as [string, string],
    serviceId: service.id,
    ownerId: owner.id,
    ctx: ctxFor(owner.id, t, "OWNER"),
  };
}

export function ctxFor(
  userId: string,
  t: { id: string; slug: string; name: string; timezone: string; currency: string },
  role: Role,
  barberId: string | null = null,
): AuthContext {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    userName: "Test",
    email: "test@test.local",
    tenantId: t.id,
    tenantSlug: t.slug,
    tenantName: t.name,
    timezone: t.timezone,
    currency: t.currency,
    role,
    barberId,
    memberships: [{ tenantId: t.id, tenantName: t.name, role }],
  };
}

/** Fecha local (Santiago) dentro de N días, para no depender de "hoy". */
export function futureDate(days = 3): string {
  return addDays(todayIn("America/Santiago"), days);
}

/** ISO de una hora local en Santiago. */
export function santiagoIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, "America/Santiago").toISOString();
}

export function bookingInput(f: Fixture, startsAt: string, extra: Record<string, unknown> = {}) {
  return {
    branchId: f.branchId,
    serviceId: f.serviceId,
    barberId: f.barberIds[0],
    startsAt,
    customer: { name: "Cliente Prueba", phone: "+56912345678", email: "" },
    consents: { whatsapp: true, email: false, marketing: false },
    acceptTerms: true as const,
    ...extra,
  };
}

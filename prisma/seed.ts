/**
 * SEED DE DESARROLLO — datos ficticios claramente identificados.
 * NUNCA se ejecuta en producción (se aborta si NODE_ENV=production o si la URL parece de Supabase).
 *
 * Credenciales SOLO DE DESARROLLO (no usar en ningún entorno real):
 *   dueño:      dueno@facha.dev       / FachaDev2026
 *   recepción:  recepcion@facha.dev   / FachaDev2026
 *   barbero:    nico@facha.dev        / FachaDev2026
 */
import "dotenv/config";
import { createTenant, hashPassword } from "@/modules/identity";
import { db } from "@/shared/db";
import { addDays, addMinutes, todayIn, zonedToUtc } from "@/shared/time";

const DEV_PASSWORD = "FachaDev2026";
const TZ = "America/Santiago";

async function main() {
  if (process.env.NODE_ENV === "production" || /supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("El seed de desarrollo no puede ejecutarse contra producción");
  }
  if (await db.tenant.findUnique({ where: { slug: "facha-style" } })) {
    console.log("Seed ya aplicado (existe facha-style). Nada que hacer.");
    return;
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const owner = await db.user.create({
    data: { email: "dueno@facha.dev", name: "Dueño (DEV)", passwordHash },
  });
  const { id: tenantId } = await createTenant({
    name: "Facha Style",
    slug: "facha-style",
    ownerUserId: owner.id,
  });
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      description: "Barbería urbana. Cortes, fades y barba. [DATOS DE DESARROLLO]",
      publicPhone: "+56 9 0000 0000",
      instagram: "fachastyle.dev",
      paymentPolicy: "OPTIONAL",
      depositAmount: 5000,
      minNoticeMinutes: 30,
      bookingTerms:
        "Llega 5 minutos antes. Si no puedes venir, cancela con anticipación para liberar la hora.",
    },
  });

  const centro = await db.branch.create({
    data: {
      tenantId,
      slug: "centro",
      name: "Facha Centro",
      address: "Av. Ejemplo 123, Santiago (ficticia)",
      timezone: TZ,
    },
  });

  const services = await Promise.all(
    [
      { name: "Corte clásico", priceAmount: 12000, durationMinutes: 30, bufferMinutes: 10, sortOrder: 1 },
      {
        name: "Degradado / Fade",
        priceAmount: 15000,
        durationMinutes: 45,
        bufferMinutes: 10,
        sortOrder: 2,
        description: "Skin, low, mid o high fade",
      },
      { name: "Perfilado de barba", priceAmount: 8000, durationMinutes: 20, bufferMinutes: 5, sortOrder: 3 },
      { name: "Corte + barba", priceAmount: 20000, durationMinutes: 60, bufferMinutes: 10, sortOrder: 4 },
      { name: "Diseño / líneas", priceAmount: 5000, durationMinutes: 15, bufferMinutes: 5, sortOrder: 5 },
    ].map((s) => db.service.create({ data: { ...s, tenantId } })),
  );
  await db.serviceBranch.createMany({
    data: services.map((s) => ({ tenantId, serviceId: s.id, branchId: centro.id })),
  });

  const barbers = await Promise.all(
    [
      { displayName: "Nico", bio: "Fades y diseños. 8 años de oficio.", commissionBps: 4500, sortOrder: 1 },
      { displayName: "Mati", bio: "Clásicos y barba con navaja.", commissionBps: 4000, sortOrder: 2 },
      { displayName: "Seba", bio: "Texturas y cortes modernos.", commissionBps: 4000, sortOrder: 3 },
    ].map((b) => db.barber.create({ data: { ...b, tenantId } })),
  );
  for (const b of barbers) {
    await db.barberBranch.create({ data: { tenantId, barberId: b.id, branchId: centro.id } });
    await db.barberService.createMany({
      data: services.map((s) => ({ tenantId, barberId: b.id, serviceId: s.id })),
    });
    // Lunes a sábado 10:00-14:00 y 15:00-20:00 (pausa de almuerzo)
    await db.workingHours.createMany({
      data: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        { tenantId, barberId: b.id, branchId: centro.id, weekday, startMinute: 600, endMinute: 840 },
        { tenantId, barberId: b.id, branchId: centro.id, weekday, startMinute: 900, endMinute: 1200 },
      ]),
    });
  }

  const recep = await db.user.create({
    data: { email: "recepcion@facha.dev", name: "Recepción (DEV)", passwordHash },
  });
  await db.membership.create({ data: { tenantId, userId: recep.id, role: "RECEPTIONIST" } });
  const nicoUser = await db.user.create({
    data: { email: "nico@facha.dev", name: "Nico (DEV)", passwordHash },
  });
  await db.membership.create({
    data: { tenantId, userId: nicoUser.id, role: "BARBER", barberId: barbers[0]!.id },
  });

  // Historial ficticio para que el dashboard muestre datos (marcado como demo).
  const today = todayIn(TZ);
  let n = 0;
  for (let dayOffset = -20; dayOffset <= 3; dayOffset++) {
    const date = addDays(today, dayOffset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    for (const [i, hour] of [11, 16, 18].entries()) {
      const barber = barbers[(dayOffset + i + 30) % barbers.length]!;
      const service = services[(dayOffset + i + 30) % services.length]!;
      n++;
      const phone = `+5699${String(1000000 + (n % 25)).padStart(7, "0")}`;
      const customer = await db.customer.upsert({
        where: { tenantId_phoneE164: { tenantId, phoneE164: phone } },
        create: { tenantId, name: `Cliente Demo ${(n % 25) + 1}`, phoneE164: phone },
        update: {},
      });
      const startsAt = zonedToUtc(date, hour * 60, TZ);
      const endsAt = addMinutes(startsAt, service.durationMinutes);
      const past = dayOffset < 0;
      const status = past
        ? n % 11 === 0
          ? "NO_SHOW"
          : n % 7 === 0
            ? "CANCELLED"
            : "COMPLETED"
        : "CONFIRMED";
      await db.appointment.create({
        data: {
          tenantId,
          branchId: centro.id,
          barberId: barber.id,
          serviceId: service.id,
          customerId: customer.id,
          status,
          source: n % 3 === 0 ? "WHATSAPP" : "WEB",
          startsAt,
          endsAt,
          blockedUntil: addMinutes(endsAt, service.bufferMinutes),
          serviceName: service.name,
          priceAmount: service.priceAmount,
          currency: "CLP",
          durationMinutes: service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
          campaign: n % 4 === 0 ? "espejo" : n % 5 === 0 ? "instagram" : null,
          manageTokenExpiresAt: addMinutes(startsAt, 1440),
          completedAt: status === "COMPLETED" ? endsAt : null,
          cancelledAt: status === "CANCELLED" ? startsAt : null,
        },
      });
      if (status === "COMPLETED") {
        await db.customer.update({
          where: { id: customer.id },
          data: { visitCount: { increment: 1 }, lastVisitAt: startsAt },
        });
      }
    }
  }
  await db.communicationConsent.createMany({
    data: (await db.customer.findMany({ where: { tenantId } })).map((c) => ({
      tenantId,
      customerId: c.id,
      channel: "WHATSAPP" as const,
      purpose: "TRANSACTIONAL" as const,
      granted: true,
      source: "seed_dev",
    })),
  });

  // Si hay un número de prueba de WhatsApp en .env, se vincula a esta barbería (el token sale de WHATSAPP_ACCESS_TOKEN).
  if (process.env.WHATSAPP_PHONE_NUMBER_ID) {
    await db.tenantIntegration.create({
      data: {
        tenantId,
        kind: "WHATSAPP",
        enabled: true,
        externalAccountId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      },
    });
  }

  console.log("✔ Seed de desarrollo aplicado.");
  console.log("  Página pública: /b/facha-style");
  console.log("  Panel: /admin (usuarios y contraseña de desarrollo documentados en prisma/seed.ts)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

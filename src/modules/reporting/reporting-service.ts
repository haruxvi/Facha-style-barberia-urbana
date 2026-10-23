import { assertCan, type AuthContext } from "@/modules/identity";
import { db } from "@/shared/db";
import { addDays, localParts, parseLocalDate, todayIn, weekdayOf, zonedToUtc } from "@/shared/time";

const BOOKED = ["CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW"] as const;

function rangeFor(tz: string, from: string, toExclusive: string) {
  return { from: zonedToUtc(from, 0, tz), to: zonedToUtc(toExclusive, 0, tz) };
}

/** Lunes de la semana local que contiene `date`. */
function weekStart(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, -((wd + 6) % 7));
}

function monthStart(date: string): string {
  const { year, month } = parseLocalDate(date);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function nextMonthStart(date: string): string {
  const { year, month } = parseLocalDate(date);
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

async function completedRevenue(tenantId: string, from: Date, to: Date): Promise<number> {
  const r = await db.appointment.aggregate({
    where: { tenantId, status: "COMPLETED", startsAt: { gte: from, lt: to } },
    _sum: { priceAmount: true },
  });
  return r._sum.priceAmount ?? 0;
}

export async function getDashboard(ctx: AuthContext) {
  assertCan(ctx, "dashboard.view");
  const tz = ctx.timezone;
  const today = todayIn(tz);
  const day = rangeFor(tz, today, addDays(today, 1));
  const week = rangeFor(tz, weekStart(today), addDays(weekStart(today), 7));
  const month = rangeFor(tz, monthStart(today), nextMonthStart(today));
  const t = ctx.tenantId;

  const [
    todayList,
    upcoming,
    revDay,
    revWeek,
    revMonth,
    pendingPayments,
    cancelled,
    noShows,
    topServices,
    recurring,
    occupancy,
  ] = await Promise.all([
    db.appointment.findMany({
      where: { tenantId: t, startsAt: { gte: day.from, lt: day.to }, status: { notIn: ["EXPIRED"] } },
      include: { customer: { select: { name: true } }, barber: { select: { displayName: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.appointment.count({
      where: { tenantId: t, startsAt: { gte: day.to }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } },
    }),
    completedRevenue(t, day.from, day.to),
    completedRevenue(t, week.from, week.to),
    completedRevenue(t, month.from, month.to),
    db.payment.count({ where: { tenantId: t, status: { in: ["PENDING", "IN_PROCESS"] } } }),
    db.appointment.count({
      where: { tenantId: t, status: "CANCELLED", startsAt: { gte: month.from, lt: month.to } },
    }),
    db.appointment.count({
      where: { tenantId: t, status: "NO_SHOW", startsAt: { gte: month.from, lt: month.to } },
    }),
    db.appointment.groupBy({
      by: ["serviceName"],
      where: { tenantId: t, status: { in: [...BOOKED] }, startsAt: { gte: month.from, lt: month.to } },
      _count: { _all: true },
      orderBy: { _count: { serviceName: "desc" } },
      take: 5,
    }),
    db.customer.count({ where: { tenantId: t, visitCount: { gte: 2 }, anonymizedAt: null } }),
    computeOccupancy(t, tz, weekStart(today), 7),
  ]);

  return {
    today,
    todayList,
    upcoming,
    revenue: { day: revDay, week: revWeek, month: revMonth },
    pendingPayments,
    cancelledMonth: cancelled,
    noShowsMonth: noShows,
    topServices: topServices.map((s) => ({ name: s.serviceName, count: s._count._all })),
    recurringCustomers: recurring,
    occupancy,
  };
}

/** Ocupación = minutos reservados / minutos laborales disponibles (descontando ausencias). */
async function computeOccupancy(tenantId: string, tz: string, from: string, days: number) {
  const range = rangeFor(tz, from, addDays(from, days));
  const [barbers, hours, exceptions, appts] = await Promise.all([
    db.barber.findMany({ where: { tenantId, active: true }, select: { id: true, displayName: true } }),
    db.workingHours.findMany({ where: { tenantId } }),
    db.scheduleException.findMany({
      where: { tenantId, type: "TIME_OFF", startsAt: { lt: range.to }, endsAt: { gt: range.from } },
    }),
    db.appointment.findMany({
      where: { tenantId, status: { in: [...BOOKED] }, startsAt: { gte: range.from, lt: range.to } },
      select: { barberId: true, durationMinutes: true },
    }),
  ]);
  return barbers.map((b) => {
    let available = 0;
    for (let i = 0; i < days; i++) {
      const wd = weekdayOf(addDays(from, i));
      for (const h of hours)
        if (h.barberId === b.id && h.weekday === wd) available += h.endMinute - h.startMinute;
    }
    for (const ex of exceptions) {
      if (ex.barberId !== b.id && ex.barberId !== null) continue;
      const s = Math.max(ex.startsAt.getTime(), range.from.getTime());
      const e = Math.min(ex.endsAt.getTime(), range.to.getTime());
      available -= Math.max(0, Math.min((e - s) / 60000, available));
    }
    const booked = appts.filter((a) => a.barberId === b.id).reduce((acc, a) => acc + a.durationMinutes, 0);
    return {
      barberId: b.id,
      name: b.displayName,
      bookedMinutes: booked,
      availableMinutes: Math.max(0, Math.round(available)),
      rate: available > 0 ? Math.min(1, booked / available) : 0,
    };
  });
}

export async function getReport(ctx: AuthContext, from: string, toInclusive: string) {
  assertCan(ctx, "reports.view");
  const tz = ctx.timezone;
  const range = rangeFor(tz, from, addDays(toInclusive, 1));
  const t = ctx.tenantId;
  const days = Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000));

  const [appointments, barbers, payments, campaigns, visits] = await Promise.all([
    db.appointment.findMany({
      where: { tenantId: t, startsAt: { gte: range.from, lt: range.to }, status: { not: "EXPIRED" } },
      select: {
        status: true,
        priceAmount: true,
        serviceName: true,
        barberId: true,
        customerId: true,
        startsAt: true,
        campaign: true,
        source: true,
      },
    }),
    db.barber.findMany({
      where: { tenantId: t },
      select: { id: true, displayName: true, commissionBps: true },
    }),
    db.payment.findMany({
      where: { tenantId: t, approvedAt: { gte: range.from, lt: range.to } },
      select: { amount: true, refundedAmount: true, status: true },
    }),
    db.qrCampaign.findMany({ where: { tenantId: t } }),
    db.campaignVisit.groupBy({
      by: ["campaign"],
      where: { tenantId: t, day: { gte: from, lte: toInclusive } },
      _sum: { visits: true },
    }),
  ]);

  const completed = appointments.filter((a) => a.status === "COMPLETED");
  const byBarber = barbers.map((b) => {
    const mine = appointments.filter((a) => a.barberId === b.id);
    const done = mine.filter((a) => a.status === "COMPLETED");
    const revenue = done.reduce((s, a) => s + a.priceAmount, 0);
    return {
      name: b.displayName,
      bookings: mine.filter((a) => a.status !== "CANCELLED").length,
      completed: done.length,
      noShows: mine.filter((a) => a.status === "NO_SHOW").length,
      revenue,
      commissionBps: b.commissionBps,
      commission: Math.round((revenue * b.commissionBps) / 10_000),
    };
  });
  const serviceMap = new Map<string, { count: number; revenue: number }>();
  for (const a of appointments.filter((x) => x.status !== "CANCELLED")) {
    const cur = serviceMap.get(a.serviceName) ?? { count: 0, revenue: 0 };
    cur.count++;
    if (a.status === "COMPLETED") cur.revenue += a.priceAmount;
    serviceMap.set(a.serviceName, cur);
  }
  const customerCounts = new Map<string, number>();
  for (const a of completed) customerCounts.set(a.customerId, (customerCounts.get(a.customerId) ?? 0) + 1);

  const byDay = new Map<string, { bookings: number; revenue: number }>();
  for (const a of appointments) {
    const d = localParts(a.startsAt, tz).date;
    const cur = byDay.get(d) ?? { bookings: 0, revenue: 0 };
    if (a.status !== "CANCELLED") cur.bookings++;
    if (a.status === "COMPLETED") cur.revenue += a.priceAmount;
    byDay.set(d, cur);
  }

  return {
    from,
    to: toInclusive,
    totals: {
      bookings: appointments.filter((a) => a.status !== "CANCELLED").length,
      completed: completed.length,
      cancelled: appointments.filter((a) => a.status === "CANCELLED").length,
      noShows: appointments.filter((a) => a.status === "NO_SHOW").length,
      revenue: completed.reduce((s, a) => s + a.priceAmount, 0),
      collectedOnline: payments.reduce((s, p) => s + p.amount - p.refundedAmount, 0),
      recurringCustomers: [...customerCounts.values()].filter((n) => n >= 2).length,
      uniqueCustomers: new Set(appointments.map((a) => a.customerId)).size,
    },
    byBarber,
    byService: [...serviceMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    bySource: (["WEB", "WHATSAPP", "ADMIN"] as const).map((s) => ({
      source: s,
      count: appointments.filter((a) => a.source === s).length,
    })),
    campaigns: [...new Set([...campaigns.map((c) => c.code), ...visits.map((v) => v.campaign)])].map(
      (code) => ({
        code,
        label: campaigns.find((c) => c.code === code)?.label ?? code,
        visits: visits.find((v) => v.campaign === code)?._sum.visits ?? 0,
        bookings: appointments.filter((a) => a.campaign === code && a.status !== "CANCELLED").length,
      }),
    ),
    occupancy: await computeOccupancy(t, tz, from, Math.min(days, 92)),
  };
}

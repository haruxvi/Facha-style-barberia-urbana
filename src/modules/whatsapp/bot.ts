/**
 * Bot conversacional de reservas por WhatsApp: máquina de estados determinista.
 *
 * El bot NO accede a la BD: usa puertos (BotPorts) que delegan en los mismos servicios de dominio
 * que la web y el panel. No inventa horarios (los pide a la disponibilidad real), no decide precios
 * ni confirma pagos.
 *
 * Interpretación de lenguaje natural opcional: ver IntentInterpreter. Si se agrega un LLM, solo puede
 * traducir el texto libre a una de las opciones ofrecidas; nunca ejecuta acciones por sí mismo.
 */

export interface BotSlot {
  startsAt: Date;
  barberIds: string[];
}

export interface BotPorts {
  tenantName: string;
  formatMoney(amount: number): string;
  formatSlot(d: Date): string;
  formatDay(date: string): string;
  upcomingDates(days: number): string[];
  listBranches(): Promise<{ id: string; name: string }[]>;
  listServices(
    branchId: string,
  ): Promise<{ id: string; name: string; priceAmount: number; durationMinutes: number }[]>;
  listBarbers(branchId: string, serviceId: string): Promise<{ id: string; displayName: string }[]>;
  getSlots(branchId: string, serviceId: string, barberId: string | null, date: string): Promise<BotSlot[]>;
  knownCustomerName(): Promise<string | null>;
  createBooking(input: {
    branchId: string;
    serviceId: string;
    barberId: string | null;
    startsAt: string;
    name: string;
    idempotencyKey: string;
  }): Promise<
    | {
        ok: true;
        status: "CONFIRMED" | "PENDING_PAYMENT";
        manageUrl: string;
        paymentUrl?: string;
        amountDue: number;
        holdMinutes: number;
      }
    | { ok: false; reason: "slot_unavailable" | "error"; message: string }
  >;
  upcoming(): Promise<{ label: string; manageUrl: string }[]>;
  revokeConsent(): Promise<void>;
}

/** Interfaz opcional para interpretar texto libre con un modelo de lenguaje. */
export interface IntentInterpreter {
  /** Devuelve el índice (1-based) de la opción elegida o null. Nunca ejecuta acciones. */
  pickOption(text: string, options: string[]): Promise<number | null>;
}

export type BotState = "idle" | "branch" | "service" | "barber" | "date" | "time" | "name" | "confirm";

export interface BotContext {
  flowId?: string;
  branchId?: string;
  branches?: { id: string; name: string }[];
  serviceId?: string;
  serviceName?: string;
  servicePrice?: number;
  services?: { id: string; name: string; priceAmount: number; durationMinutes: number }[];
  barberId?: string | null;
  barberName?: string;
  barbers?: { id: string; displayName: string }[];
  date?: string;
  dates?: string[];
  slots?: { startsAt: string; barberIds: string[] }[];
  startsAt?: string;
  name?: string;
}

export interface BotResult {
  replies: string[];
  state: BotState;
  context: BotContext;
  handoff?: boolean;
}

const MENU_WORDS = /^(hola|menu|menú|inicio|buenas|buenos dias|buenos días|buenas tardes|hey|ola)\b/i;
const HUMAN_WORDS = /\b(humano|persona|operador|ayuda|asesor)\b/i;
const STOP_WORDS = /^(baja|stop|parar|no molestar|unsubscribe)$/i;
// Sin \b: en JS "í" no es carácter de palabra y \b fallaría tras "sí".
const END = "(?=$|[\\s.,!¡?¿])";
const YES = new RegExp(`^(s[ií]|yes|ok|dale|confirmo|confirmar)${END}`, "i");
const NO = new RegExp(`^(no|cancelar|anular)${END}`, "i");

function menu(ports: BotPorts): string {
  return [
    `Hola, soy el asistente de reservas de *${ports.tenantName}*. Responde con un número:`,
    "1. Reservar una hora",
    "2. Ver, cambiar o cancelar mis reservas",
    "3. Hablar con una persona",
  ].join("\n");
}

function numbered<T>(items: T[], label: (t: T) => string, start = 1): string {
  return items.map((it, i) => `${i + start}. ${label(it)}`).join("\n");
}

function pick(text: string, max: number, allowZero = false): number | null {
  const m = /^\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (allowZero && n === 0) return 0;
  return n >= 1 && n <= max ? n : null;
}

const NOT_UNDERSTOOD =
  "No te entendí. Responde con el *número* de una opción o escribe *MENU* para volver al inicio.";

export async function handleBotMessage(
  state: BotState,
  context: BotContext,
  rawText: string,
  ports: BotPorts,
  newFlowId: () => string = () => Math.random().toString(36).slice(2, 12),
): Promise<BotResult> {
  const text = rawText.trim();

  if (STOP_WORDS.test(text)) {
    await ports.revokeConsent();
    return {
      replies: [
        "Listo. No te enviaremos más mensajes automáticos por WhatsApp. Si quieres reservar, escríbenos cuando quieras.",
      ],
      state: "idle",
      context: {},
    };
  }
  if (HUMAN_WORDS.test(text) || (state === "idle" && text === "3")) {
    return {
      replies: ["Te comunico con una persona del equipo. Te responderemos por aquí lo antes posible."],
      state: "idle",
      context: {},
      handoff: true,
    };
  }
  if (MENU_WORDS.test(text) || (state !== "idle" && NO.test(text) && state !== "confirm")) {
    return { replies: [menu(ports)], state: "idle", context: {} };
  }

  switch (state) {
    case "idle": {
      if (text === "1") return startBooking(ports, newFlowId());
      if (text === "2") {
        const list = await ports.upcoming();
        if (list.length === 0)
          return {
            replies: ["No tienes reservas próximas. Escribe *1* para reservar."],
            state: "idle",
            context: {},
          };
        return {
          replies: [
            `Tus próximas reservas:\n${numbered(list, (r) => `${r.label}\n   Ver, cambiar o cancelar: ${r.manageUrl}`)}`,
          ],
          state: "idle",
          context: {},
        };
      }
      return { replies: [menu(ports)], state: "idle", context: {} };
    }

    case "branch": {
      const n = pick(text, context.branches?.length ?? 0);
      if (!n) return { replies: [NOT_UNDERSTOOD], state, context };
      const branch = context.branches![n - 1]!;
      return askService(ports, { flowId: context.flowId, branchId: branch.id });
    }

    case "service": {
      const n = pick(text, context.services?.length ?? 0);
      if (!n) return { replies: [NOT_UNDERSTOOD], state, context };
      const s = context.services![n - 1]!;
      const barbers = await ports.listBarbers(context.branchId!, s.id);
      if (barbers.length === 0)
        return {
          replies: ["Ese servicio no tiene profesionales disponibles ahora. Elige otro."],
          state,
          context,
        };
      const next: BotContext = {
        flowId: context.flowId,
        branchId: context.branchId,
        serviceId: s.id,
        serviceName: s.name,
        servicePrice: s.priceAmount,
        barbers,
      };
      return {
        replies: [
          `¿Con quién te quieres atender?\n0. Cualquier profesional disponible\n${numbered(barbers, (b) => b.displayName)}`,
        ],
        state: "barber",
        context: next,
      };
    }

    case "barber": {
      const n = pick(text, context.barbers?.length ?? 0, true);
      if (n === null) return { replies: [NOT_UNDERSTOOD], state, context };
      const barber = n === 0 ? null : context.barbers![n - 1]!;
      const base: BotContext = {
        ...context,
        barberId: barber?.id ?? null,
        barberName: barber?.displayName ?? "cualquier profesional",
        barbers: undefined,
      };
      return askDate(ports, base);
    }

    case "date": {
      const n = pick(text, context.dates?.length ?? 0);
      if (!n) return { replies: [NOT_UNDERSTOOD], state, context };
      return askTime(ports, { ...context, date: context.dates![n - 1]!, dates: undefined });
    }

    case "time": {
      const n = pick(text, context.slots?.length ?? 0);
      if (!n) return { replies: [NOT_UNDERSTOOD], state, context };
      const slot = context.slots![n - 1]!;
      const next: BotContext = { ...context, startsAt: slot.startsAt, slots: undefined };
      const known = await ports.knownCustomerName();
      if (known) return confirmStep(ports, { ...next, name: known });
      return {
        replies: ["¿A nombre de quién hacemos la reserva? (nombre y apellido)"],
        state: "name",
        context: next,
      };
    }

    case "name": {
      const name = text.replace(/\s+/g, " ").slice(0, 80);
      if (name.length < 2 || /^\d+$/.test(name))
        return { replies: ["Escríbeme tu nombre, por favor."], state, context };
      return confirmStep(ports, { ...context, name });
    }

    case "confirm": {
      if (NO.test(text))
        return { replies: ["Reserva descartada. " + menu(ports)], state: "idle", context: {} };
      if (!YES.test(text))
        return { replies: ["Responde *SÍ* para confirmar o *NO* para descartar."], state, context };
      const r = await ports.createBooking({
        branchId: context.branchId!,
        serviceId: context.serviceId!,
        barberId: context.barberId ?? null,
        startsAt: context.startsAt!,
        name: context.name!,
        idempotencyKey: `wa:${context.flowId}`,
      });
      if (!r.ok) {
        if (r.reason === "slot_unavailable") {
          const retry = await askTime(ports, { ...context, startsAt: undefined });
          return { ...retry, replies: ["Ese horario se acaba de ocupar.", ...retry.replies] };
        }
        return {
          replies: [`No pude crear la reserva: ${r.message}`, menu(ports)],
          state: "idle",
          context: {},
        };
      }
      if (r.status === "PENDING_PAYMENT" && r.paymentUrl) {
        return {
          replies: [
            `¡Casi listo! Para confirmar tu hora paga ${ports.formatMoney(r.amountDue)} aquí (tienes ${r.holdMinutes} minutos):\n${r.paymentUrl}\n\nCuando el pago se acredite te enviaremos la confirmación.`,
          ],
          state: "idle",
          context: {},
        };
      }
      return {
        replies: [
          `Reserva confirmada.\n${context.serviceName} con ${context.barberName}\n${ports.formatSlot(new Date(context.startsAt!))}\n\nPara ver, cambiar o cancelar: ${r.manageUrl}`,
        ],
        state: "idle",
        context: {},
      };
    }
  }
  return { replies: [menu(ports)], state: "idle", context: {} };
}

async function startBooking(ports: BotPorts, flowId: string): Promise<BotResult> {
  const branches = await ports.listBranches();
  if (branches.length === 0)
    return {
      replies: ["Por ahora no tenemos reservas online. Escribe *3* para hablar con una persona."],
      state: "idle",
      context: {},
    };
  if (branches.length === 1) return askService(ports, { flowId, branchId: branches[0]!.id });
  return {
    replies: [`¿En qué sucursal?\n${numbered(branches, (b) => b.name)}`],
    state: "branch",
    context: { flowId, branches },
  };
}

async function askService(ports: BotPorts, ctx: BotContext): Promise<BotResult> {
  const services = await ports.listServices(ctx.branchId!);
  if (services.length === 0)
    return { replies: ["No hay servicios disponibles en esta sucursal."], state: "idle", context: {} };
  return {
    replies: [
      `¿Qué servicio necesitas?\n${numbered(services, (s) => `${s.name} — ${ports.formatMoney(s.priceAmount)} (${s.durationMinutes} min)`)}`,
    ],
    state: "service",
    context: { ...ctx, services },
  };
}

async function askDate(ports: BotPorts, ctx: BotContext): Promise<BotResult> {
  const candidates = ports.upcomingDates(10);
  const dates: string[] = [];
  for (const d of candidates) {
    const slots = await ports.getSlots(ctx.branchId!, ctx.serviceId!, ctx.barberId ?? null, d);
    if (slots.length > 0) dates.push(d);
    if (dates.length >= 7) break;
  }
  if (dates.length === 0) {
    return {
      replies: [
        "No encontré horas disponibles en los próximos días. Escribe *3* para hablar con una persona.",
      ],
      state: "idle",
      context: {},
    };
  }
  return {
    replies: [`¿Qué día? (${ctx.barberName})\n${numbered(dates, (d) => ports.formatDay(d))}`],
    state: "date",
    context: { ...ctx, dates },
  };
}

async function askTime(ports: BotPorts, ctx: BotContext): Promise<BotResult> {
  const slots = (await ports.getSlots(ctx.branchId!, ctx.serviceId!, ctx.barberId ?? null, ctx.date!)).slice(
    0,
    15,
  );
  if (slots.length === 0) return askDate(ports, { ...ctx, date: undefined });
  return {
    replies: [
      `Horas disponibles para ${ports.formatDay(ctx.date!)}:\n${numbered(slots, (s) => ports.formatSlot(s.startsAt).split(" · ").pop()!)}`,
    ],
    state: "time",
    context: {
      ...ctx,
      slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), barberIds: s.barberIds })),
    },
  };
}

function confirmStep(ports: BotPorts, ctx: BotContext): BotResult {
  return {
    replies: [
      [
        "Revisa tu reserva:",
        `• ${ctx.serviceName} (${ports.formatMoney(ctx.servicePrice ?? 0)})`,
        `• Con: ${ctx.barberName}`,
        `• ${ports.formatSlot(new Date(ctx.startsAt!))}`,
        `• A nombre de: ${ctx.name}`,
        "",
        "Responde *SÍ* para confirmar o *NO* para descartar.",
        "_Al confirmar aceptas recibir por WhatsApp mensajes sobre esta reserva (confirmación y recordatorio). Escribe BAJA cuando quieras para dejar de recibirlos._",
      ].join("\n"),
    ],
    state: "confirm",
    context: ctx,
  };
}

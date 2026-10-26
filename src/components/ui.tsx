import Image from "next/image";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// Altura mínima de 44px: objetivo táctil cómodo (Fitts).
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50";
const buttonVariants = {
  primary: "bg-accent text-accent-ink shadow-sm shadow-accent/20 hover:bg-accent-strong",
  secondary: "border border-line bg-surface-2 text-ink hover:border-subtle hover:bg-surface",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  // Destructivo sobrio: neutro en reposo, se insinúa el riesgo solo al interactuar.
  danger: "border border-line bg-transparent text-ink/85 hover:border-danger/60 hover:text-danger",
};

export type ButtonVariant = keyof typeof buttonVariants;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line-soft pb-6">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2 text-accent">{eyebrow}</div>}
        <h1 className="heading-page">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors duration-150 placeholder:text-subtle hover:border-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputCls, "min-h-24", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-ink/90">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" {...props} className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" />
      <span className="leading-relaxed">{label}</span>
    </label>
  );
}

/*
 * Estados: etiqueta neutra + punto de color. El color comunica el estado sin teñir toda la pieza,
 * así una tabla con muchos estados se mantiene sobria y legible.
 */
const tones = {
  neutral: "bg-subtle",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  accent: "bg-accent",
};

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line-soft bg-surface-2/70 px-2 py-0.5 text-xs font-medium text-ink/85">
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", tones[tone])} />
      {children}
    </span>
  );
}

/** Rótulo de canal (sin "píldora"): ícono + texto discreto. */
export function ChannelLabel({ channel }: { channel: "WHATSAPP" | "EMAIL" | string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
      {channel === "WHATSAPP" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="size-3.5"
          aria-hidden
        >
          <path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.2A8 8 0 1120 12z" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="size-3.5"
          aria-hidden
        >
          <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
          <path d="M4 7l8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {channel === "WHATSAPP" ? "WhatsApp" : "Correo"}
    </span>
  );
}

const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: "Pendiente de pago", tone: "warn" },
  CONFIRMED: { label: "Confirmada", tone: "info" },
  CHECKED_IN: { label: "En el local", tone: "accent" },
  COMPLETED: { label: "Completada", tone: "ok" },
  CANCELLED: { label: "Cancelada", tone: "danger" },
  NO_SHOW: { label: "No asistió", tone: "danger" },
  EXPIRED: { label: "Expirada", tone: "neutral" },
};

export function AppointmentStatusBadge({ status }: { status: string }) {
  const s = APPOINTMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Pendiente", tone: "warn" },
  IN_PROCESS: { label: "En proceso", tone: "warn" },
  APPROVED: { label: "Aprobado", tone: "ok" },
  REJECTED: { label: "Rechazado", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
  REFUNDED: { label: "Reembolsado", tone: "info" },
  PARTIALLY_REFUNDED: { label: "Reembolso parcial", tone: "info" },
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const s = PAYMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const NOTIFICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: "En cola", tone: "neutral" },
  SENDING: { label: "Enviando (revisar)", tone: "warn" },
  SENT: { label: "Enviado", tone: "info" },
  DELIVERED: { label: "Entregado", tone: "ok" },
  READ: { label: "Leído", tone: "ok" },
  FAILED: { label: "Falló", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
  SKIPPED: { label: "Omitido", tone: "neutral" },
};

export function NotificationStatusBadge({ status }: { status: string }) {
  const s = NOTIFICATION_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm leading-relaxed text-muted">
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="eyebrow text-muted">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-subtle">{hint}</div>}
    </Card>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm tabular-nums [&_td]:px-4 [&_td]:py-3.5 [&_th]:px-4 [&_th]:py-3 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.14em] [&_th]:text-subtle [&_thead]:bg-surface [&_tbody]:bg-bg [&_tbody_tr]:border-t [&_tbody_tr]:border-line-soft [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface/60">
        {children}
      </table>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  // Superficie neutra con filete lateral: el tono se lee sin "pintar" el bloque entero.
  const bar = { info: "border-l-info", warn: "border-l-warn", danger: "border-l-danger", ok: "border-l-ok" };
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx(
        "rounded-lg border border-line-soft border-l-2 bg-surface-2/60 px-4 py-3 text-sm leading-relaxed text-ink/90",
        bar[tone],
      )}
    >
      {children}
    </div>
  );
}

/** Logo de plataforma (pantallas sin barbería concreta, como el login del equipo). */
export const PLATFORM_BRAND = { name: "Facha & Style", logoUrl: "/brand/logo-badge.png" };

/**
 * Marca de una barbería: insignia (si la barbería subió logo) + nombre en serif.
 * Sin logo se muestra un monograma con la inicial, para que ninguna barbería quede "sin marca".
 */
export function Logo({
  name = PLATFORM_BRAND.name,
  logoUrl = PLATFORM_BRAND.logoUrl,
  size = "md",
  showName = true,
}: {
  name?: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  showName?: boolean;
}) {
  const px = { sm: 32, md: 44, lg: 96, xl: 168 }[size];
  return (
    <span className="inline-flex items-center gap-3">
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={showName ? "" : name}
          width={px}
          height={px}
          priority={size === "xl" || size === "lg"}
          unoptimized={logoUrl.startsWith("http")}
          className="shrink-0 rounded-full shadow-lg shadow-black/40"
        />
      ) : (
        <span
          aria-hidden
          style={{ width: px, height: px }}
          className="flex shrink-0 items-center justify-center rounded-full border border-accent/50 bg-surface font-display text-accent"
        >
          {name.slice(0, 1)}
        </span>
      )}
      {showName && (
        <span
          className={cx(
            "font-display font-semibold tracking-tight",
            size === "sm" ? "text-base" : size === "md" ? "text-lg" : "text-2xl",
          )}
        >
          {name}
        </span>
      )}
    </span>
  );
}

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const buttonVariants = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong",
  secondary: "border border-line bg-surface-2 text-ink hover:border-muted",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
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
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

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
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input type="checkbox" {...props} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
      <span>{label}</span>
    </label>
  );
}

const tones = {
  neutral: "bg-surface-2 text-muted border-line",
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
  accent: "bg-accent/10 text-accent border-accent/30",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

const APPOINTMENT_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
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

const PAYMENT_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
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

const NOTIFICATION_STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
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
    <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted [&_thead]:bg-surface-2 [&_tbody_tr]:border-t [&_tbody_tr]:border-line">
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
  const map = {
    info: "border-info/30 bg-info/5 text-info",
    warn: "border-warn/30 bg-warn/5 text-warn",
    danger: "border-danger/30 bg-danger/5 text-danger",
    ok: "border-ok/30 bg-ok/5 text-ok",
  };
  return <div className={cx("rounded-lg border px-4 py-3 text-sm", map[tone])}>{children}</div>;
}

export function Logo({ name = "Facha Style", small = false }: { name?: string; small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 24 24" className={small ? "size-5" : "size-7"} aria-hidden>
        <rect x="9" y="1.5" width="6" height="21" rx="3" fill="#f3efe6" />
        <path d="M9 5l6 3M9 10l6 3M9 15l6 3" stroke="#ef5f57" strokeWidth="1.8" />
        <path d="M9 7.5l6 3M9 12.5l6 3" stroke="#6aa6ff" strokeWidth="1.2" />
      </svg>
      <span
        className={cx(
          "font-display font-semibold uppercase tracking-[0.12em]",
          small ? "text-base" : "text-xl",
        )}
      >
        {name}
      </span>
    </span>
  );
}

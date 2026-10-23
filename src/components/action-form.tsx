"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice, type ButtonVariant } from "./ui";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string } | null;

function Submit({
  label,
  variant,
  pendingLabel,
}: {
  label: string;
  variant: ButtonVariant;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? (pendingLabel ?? "Guardando…") : label}
    </Button>
  );
}

/**
 * Formulario ligado a una Server Action que devuelve ActionResult.
 * Muestra el error o la confirmación devuelta por el servidor (la validación real ocurre allí).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Guardar",
  pendingLabel,
  variant = "primary",
  className,
  resetOnSuccess = false,
  confirm,
  inline = false,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className ?? (inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-4")}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className={inline ? "contents" : "flex flex-wrap items-center gap-3"}>
        <Submit label={submitLabel} variant={variant} pendingLabel={pendingLabel} />
        {!inline &&
          state &&
          (state.ok ? state.message && <span className="text-sm text-ok">{state.message}</span> : null)}
      </div>
      {state && !state.ok && <Notice tone="danger">{state.error}</Notice>}
      {inline && state?.ok && state.message && <span className="text-xs text-ok">{state.message}</span>}
    </form>
  );
}

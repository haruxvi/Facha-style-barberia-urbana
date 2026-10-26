import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/modules/identity";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Notice } from "@/components/ui";
import { loginAction } from "../actions";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; invitacion?: string }>;
}) {
  if (await getAuth()) redirect("/admin");
  const sp = await searchParams;
  return (
    <AuthShell title="Acceso del equipo" subtitle="Ingresa para gestionar la agenda y las reservas.">
      {sp.reset && <Notice tone="ok">Contraseña actualizada. Ya puedes ingresar.</Notice>}
      {sp.invitacion && <Notice tone="ok">Invitación aceptada. Ingresa con tu correo.</Notice>}
      <ActionForm action={loginAction} submitLabel="Ingresar" pendingLabel="Ingresando…">
        <Field label="Correo">
          <Input name="email" type="email" required autoComplete="username" />
        </Field>
        <Field label="Contraseña">
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
      </ActionForm>
      <Link href="/admin/olvide" className="block text-sm text-muted hover:text-ink">
        ¿Olvidaste tu contraseña?
      </Link>
      <p className="text-xs text-muted">
        ¿Eres cliente? No necesitas cuenta: reserva desde la página de tu barbería.
      </p>
    </AuthShell>
  );
}

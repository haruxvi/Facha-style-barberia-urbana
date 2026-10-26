import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { forgotPasswordAction } from "../actions";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Recuperar contraseña" };

export default function ForgotPage() {
  return (
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una nueva.">
      <ActionForm action={forgotPasswordAction} submitLabel="Enviar enlace" resetOnSuccess>
        <Field label="Correo">
          <Input name="email" type="email" required autoComplete="username" />
        </Field>
      </ActionForm>
      <Link href="/admin/login" className="block text-sm text-muted hover:text-ink">
        ← Volver
      </Link>
    </AuthShell>
  );
}

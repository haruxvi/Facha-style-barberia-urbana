import { ActionForm } from "@/components/action-form";
import { Field, Input, Notice } from "@/components/ui";
import { resetPasswordAction } from "../actions";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Nueva contraseña", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Nueva contraseña">
      {!token ? (
        <Notice tone="danger">Enlace inválido.</Notice>
      ) : (
        <ActionForm action={resetPasswordAction} submitLabel="Guardar contraseña">
          <input type="hidden" name="token" value={token} />
          <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números">
            <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
          </Field>
          <Field label="Repetir contraseña">
            <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
          </Field>
        </ActionForm>
      )}
    </AuthShell>
  );
}

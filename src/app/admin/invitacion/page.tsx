import { getInvitation, ROLE_LABELS } from "@/modules/identity";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Notice } from "@/components/ui";
import { acceptInvitationAction } from "../actions";
import { AuthShell } from "../auth-shell";

export const metadata = { title: "Invitación", robots: { index: false } };

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const inv = token ? await getInvitation(token) : null;
  return (
    <AuthShell title="Únete al equipo">
      {!inv || !token ? (
        <Notice tone="danger">La invitación no es válida o ya expiró. Pide una nueva.</Notice>
      ) : (
        <>
          <p className="text-sm text-muted">
            Te invitaron a <b className="text-ink">{inv.tenantName}</b> como{" "}
            <b className="text-ink">{ROLE_LABELS[inv.role]}</b> ({inv.email}).
          </p>
          <ActionForm action={acceptInvitationAction} submitLabel="Aceptar invitación">
            <input type="hidden" name="token" value={token} />
            {!inv.userExists && (
              <Field label="Tu nombre">
                <Input name="name" required minLength={2} autoComplete="name" />
              </Field>
            )}
            <Field
              label={inv.userExists ? "Tu contraseña actual" : "Crea una contraseña"}
              hint={
                inv.userExists
                  ? "Ya tienes cuenta: confirma que eres tú"
                  : "Mínimo 10 caracteres, con letras y números"
              }
            >
              <Input
                name="password"
                type="password"
                required
                autoComplete={inv.userExists ? "current-password" : "new-password"}
              />
            </Field>
          </ActionForm>
        </>
      )}
    </AuthShell>
  );
}

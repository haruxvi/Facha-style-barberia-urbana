import { ButtonLink } from "@/components/ui";
import { AuthShell } from "../auth-shell";

export default function NoPermissionPage() {
  return (
    <AuthShell title="Sin permiso">
      <p className="text-sm text-muted">
        Tu rol no tiene acceso a esta sección. Pide acceso al dueño de la barbería.
      </p>
      <ButtonLink href="/admin" variant="secondary">
        Volver al panel
      </ButtonLink>
    </AuthShell>
  );
}

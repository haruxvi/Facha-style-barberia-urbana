import { listBarbers } from "@/modules/catalog";
import { listMembers, requireAuth, ROLE_LABELS } from "@/modules/identity";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select, Table } from "@/components/ui";
import { formatDateTime } from "@/shared/time";
import { inviteMemberAction, revokeInvitationAction, updateMemberAction } from "../../actions";

export const metadata = { title: "Usuarios" };

const ROLES = ["OWNER", "ADMIN", "RECEPTIONIST", "BARBER"] as const;

export default async function UsersPage() {
  const ctx = await requireAuth("users.manage");
  const [{ members, invitations }, barbers] = await Promise.all([listMembers(ctx), listBarbers(ctx)]);

  return (
    <>
      <PageHeader
        title="Usuarios del equipo"
        description="Solo el personal tiene cuenta. Los permisos se comprueban en el servidor en cada acción."
      />
      <Table>
        <thead>
          <tr>
            <th>Persona</th>
            <th>Rol</th>
            <th>Perfil de barbero</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                <div className="font-medium">{m.user.name}</div>
                <div className="text-xs text-muted">{m.user.email}</div>
              </td>
              <td colSpan={2}>
                {m.userId === ctx.userId ? (
                  <Badge tone="accent">{ROLE_LABELS[m.role]} (tú)</Badge>
                ) : (
                  <ActionForm action={updateMemberAction} submitLabel="Guardar" variant="ghost" inline>
                    <input type="hidden" name="membershipId" value={m.id} />
                    <Select name="role" defaultValue={m.role} className="w-40">
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                    <Select name="barberId" defaultValue={m.barberId ?? ""} className="w-40">
                      <option value="">— Sin perfil —</option>
                      {barbers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.displayName}
                        </option>
                      ))}
                    </Select>
                  </ActionForm>
                )}
              </td>
              <td>{m.active ? <Badge tone="ok">Activo</Badge> : <Badge tone="danger">Desactivado</Badge>}</td>
              <td>
                {m.userId !== ctx.userId && (
                  <ActionForm
                    action={updateMemberAction}
                    submitLabel={m.active ? "Desactivar" : "Reactivar"}
                    variant={m.active ? "danger" : "secondary"}
                    inline
                    confirm={m.active ? "Se cerrarán sus sesiones. ¿Continuar?" : undefined}
                  >
                    <input type="hidden" name="membershipId" value={m.id} />
                    <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Invitar</h2>
          <ActionForm action={inviteMemberAction} submitLabel="Enviar invitación" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Correo">
                <Input name="email" type="email" required />
              </Field>
              <Field label="Rol">
                <Select name="role" defaultValue="RECEPTIONIST">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted">El enlace es de un solo uso y vence en 7 días.</p>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-4 font-display text-lg uppercase tracking-wide">Invitaciones pendientes</h2>
          {invitations.length === 0 && <p className="text-sm text-muted">No hay invitaciones pendientes.</p>}
          <ul className="divide-y divide-line text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {i.email} · {ROLE_LABELS[i.role]}
                  <span className="block text-xs text-muted">
                    Vence {formatDateTime(i.expiresAt, ctx.timezone)}
                  </span>
                </span>
                <ActionForm action={revokeInvitationAction} submitLabel="Revocar" variant="ghost" inline>
                  <input type="hidden" name="invitationId" value={i.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

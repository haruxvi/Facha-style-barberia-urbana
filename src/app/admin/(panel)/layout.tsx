import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireAuth, ROLE_LABELS, type Permission } from "@/modules/identity";
import { Logo } from "@/components/ui";
import { logoutAction, switchTenantAction } from "../actions";
import { NavLinks } from "./nav-links";

const NAV: { href: string; label: string; perm: Permission }[] = [
  { href: "/admin", label: "Inicio", perm: "dashboard.view" },
  { href: "/admin/agenda", label: "Agenda", perm: "agenda.view" },
  { href: "/admin/reservas", label: "Reservas", perm: "agenda.view" },
  { href: "/admin/clientes", label: "Clientes", perm: "customers.view" },
  { href: "/admin/mensajes", label: "Mensajes", perm: "messages.send" },
  { href: "/admin/servicios", label: "Servicios", perm: "catalog.manage" },
  { href: "/admin/barberos", label: "Barberos", perm: "barbers.manage" },
  { href: "/admin/sucursales", label: "Sucursales", perm: "branches.manage" },
  { href: "/admin/automatizaciones", label: "Automatizaciones", perm: "automations.manage" },
  { href: "/admin/pagos", label: "Pagos", perm: "payments.view" },
  { href: "/admin/reportes", label: "Reportes", perm: "reports.view" },
  { href: "/admin/usuarios", label: "Usuarios", perm: "users.manage" },
  { href: "/admin/configuracion", label: "Configuración", perm: "settings.manage" },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  // Los barberos tienen su propio portal (solo sus citas).
  if (!can(ctx.role, "dashboard.view")) redirect("/barber/agenda");
  const items = NAV.filter((n) => can(ctx.role, n.perm)).map(({ href, label }) => ({ href, label }));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col gap-4 p-4">
          <Link href="/admin">
            <Logo name={ctx.tenantName} small />
          </Link>
          {ctx.memberships.length > 1 && (
            <form action={switchTenantAction}>
              <select
                name="tenantId"
                defaultValue={ctx.tenantId}
                className="w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm"
                aria-label="Cambiar de barbería"
              >
                {ctx.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenantName}
                  </option>
                ))}
              </select>
              <button className="mt-1 text-xs text-accent hover:underline">Cambiar</button>
            </form>
          )}
          <NavLinks items={items} />
          <div className="mt-auto hidden space-y-2 border-t border-line pt-4 text-sm lg:block">
            <div>
              <div className="font-medium">{ctx.userName}</div>
              <div className="text-xs text-muted">{ROLE_LABELS[ctx.role]}</div>
            </div>
            <a
              href={`/b/${ctx.tenantSlug}`}
              target="_blank"
              className="block text-xs text-accent hover:underline"
            >
              Ver página pública ↗
            </a>
            <form action={logoutAction}>
              <button className="text-xs text-muted hover:text-ink">Cerrar sesión</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 lg:px-8 lg:py-8">
        {children}
        <form action={logoutAction} className="mt-10 lg:hidden">
          <button className="text-sm text-muted hover:text-ink">Cerrar sesión</button>
        </form>
      </main>
    </div>
  );
}

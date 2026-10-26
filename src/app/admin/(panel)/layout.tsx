import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireAuth, ROLE_LABELS, type Permission } from "@/modules/identity";
import { MobileNav, SideNav, type NavGroup } from "@/components/side-nav";
import { Logo } from "@/components/ui";
import { logoutAction, switchTenantAction } from "../actions";

/**
 * Navegación lateral vertical, agrupada por frecuencia de uso (Hick + región común):
 * lo diario arriba; la estructura del negocio en medio; la administración al final.
 */
const NAV: { group: string; items: { href: string; label: string; perm: Permission }[] }[] = [
  {
    group: "Día a día",
    items: [
      { href: "/admin", label: "Inicio", perm: "dashboard.view" },
      { href: "/admin/agenda", label: "Agenda", perm: "agenda.view" },
      { href: "/admin/reservas", label: "Reservas", perm: "agenda.view" },
      { href: "/admin/clientes", label: "Clientes", perm: "customers.view" },
      { href: "/admin/mensajes", label: "Mensajes", perm: "messages.send" },
    ],
  },
  {
    group: "Barbería",
    items: [
      { href: "/admin/servicios", label: "Servicios", perm: "catalog.manage" },
      { href: "/admin/barberos", label: "Barberos", perm: "barbers.manage" },
      { href: "/admin/sucursales", label: "Sucursales", perm: "branches.manage" },
      { href: "/admin/automatizaciones", label: "Automatizaciones", perm: "automations.manage" },
    ],
  },
  {
    group: "Administración",
    items: [
      { href: "/admin/pagos", label: "Pagos", perm: "payments.view" },
      { href: "/admin/reportes", label: "Reportes", perm: "reports.view" },
      { href: "/admin/usuarios", label: "Equipo", perm: "users.manage" },
      { href: "/admin/configuracion", label: "Configuración", perm: "settings.manage" },
    ],
  },
];

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  // Los barberos tienen su propio portal (solo sus citas).
  if (!can(ctx.role, "dashboard.view")) redirect("/barber/agenda");
  const groups: NavGroup[] = NAV.map((g) => ({
    group: g.group,
    items: g.items.filter((n) => can(ctx.role, n.perm)).map(({ href, label }) => ({ href, label })),
  })).filter((g) => g.items.length > 0);

  const account = (
    <div className="space-y-3 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{ctx.userName}</div>
        <div className="text-xs text-subtle">{ROLE_LABELS[ctx.role]}</div>
      </div>
      <div className="flex flex-col gap-1">
        <a href={`/b/${ctx.tenantSlug}`} target="_blank" className="text-muted hover:text-ink">
          Ver página pública
        </a>
        <form action={logoutAction}>
          <button className="text-muted hover:text-ink">Cerrar sesión</button>
        </form>
      </div>
    </div>
  );

  const tenantSwitch =
    ctx.memberships.length > 1 ? (
      <form action={switchTenantAction} className="flex gap-2">
        <select
          name="tenantId"
          defaultValue={ctx.tenantId}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-sm"
          aria-label="Cambiar de barbería"
        >
          {ctx.memberships.map((m) => (
            <option key={m.tenantId} value={m.tenantId}>
              {m.tenantName}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-md border border-line px-3 text-xs text-muted hover:text-ink">
          Ir
        </button>
      </form>
    ) : null;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Escritorio: barra lateral fija */}
      <aside className="hidden border-r border-line-soft bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-8 lg:overflow-y-auto lg:p-5">
        <Link href="/admin" className="rounded-md">
          <Logo name={ctx.tenantName} logoUrl={ctx.tenantLogoUrl} size="sm" />
        </Link>
        {tenantSwitch}
        <SideNav groups={groups} root="/admin" />
        <div className="mt-auto border-t border-line-soft pt-5">{account}</div>
      </aside>

      {/* Móvil: cabecera con menú desplegable vertical */}
      <header className="sticky top-0 z-30 border-b border-line-soft bg-bg/95 px-4 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between">
          <Link href="/admin">
            <Logo name={ctx.tenantName} logoUrl={ctx.tenantLogoUrl} size="sm" />
          </Link>
          <form action={logoutAction}>
            <button className="text-sm text-muted hover:text-ink">Salir</button>
          </form>
        </div>
        <MobileNav groups={groups} root="/admin" />
      </header>

      <main className="min-w-0 px-4 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

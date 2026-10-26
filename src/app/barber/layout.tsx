import Link from "next/link";
import { requireAuth } from "@/modules/identity";
import { MobileNav, SideNav, type NavGroup } from "@/components/side-nav";
import { Logo, Notice } from "@/components/ui";
import { logoutAction } from "../admin/actions";

export default async function BarberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth("barber.portal");
  const groups: NavGroup[] = [
    {
      group: "Portal del barbero",
      items: [
        { href: "/barber/agenda", label: "Mi agenda" },
        { href: "/barber/reservas", label: "Mis reservas" },
        { href: "/barber/perfil", label: "Perfil" },
      ],
    },
  ];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-line-soft bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:gap-8 lg:p-5">
        <Logo name={ctx.tenantName} logoUrl={ctx.tenantLogoUrl} size="sm" />
        <SideNav groups={groups} root="/barber" />
        <div className="mt-auto flex flex-col gap-1 border-t border-line-soft pt-5 text-sm">
          <span className="font-medium">{ctx.userName}</span>
          {ctx.role !== "BARBER" && (
            <Link href="/admin" className="text-muted hover:text-ink">
              Ir al panel
            </Link>
          )}
          <form action={logoutAction}>
            <button className="text-muted hover:text-ink">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      <header className="sticky top-0 z-30 border-b border-line-soft bg-bg/95 px-4 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between">
          <Logo name={ctx.tenantName} logoUrl={ctx.tenantLogoUrl} size="sm" />
          <form action={logoutAction}>
            <button className="text-sm text-muted hover:text-ink">Salir</button>
          </form>
        </div>
        <MobileNav groups={groups} root="/barber" />
      </header>
      <main className="min-w-0 px-4 py-8 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-4xl">
          {!ctx.barberId ? (
            <Notice tone="warn">
              Tu usuario no está vinculado a un perfil de barbero. Pídeselo al dueño (Equipo).
            </Notice>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

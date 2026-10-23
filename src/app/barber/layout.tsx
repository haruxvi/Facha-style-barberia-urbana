import Link from "next/link";
import { requireAuth } from "@/modules/identity";
import { Logo, Notice } from "@/components/ui";
import { logoutAction } from "../admin/actions";

export default async function BarberLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth("barber.portal");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-4 py-3">
          <Logo name={ctx.tenantName} small />
          <nav className="flex gap-1 text-sm">
            <Link className="rounded-lg px-3 py-1.5 hover:bg-surface-2" href="/barber/agenda">
              Mi agenda
            </Link>
            <Link className="rounded-lg px-3 py-1.5 hover:bg-surface-2" href="/barber/reservas">
              Mis reservas
            </Link>
            <Link className="rounded-lg px-3 py-1.5 hover:bg-surface-2" href="/barber/perfil">
              Perfil
            </Link>
            {ctx.role !== "BARBER" && (
              <Link className="rounded-lg px-3 py-1.5 text-accent hover:bg-surface-2" href="/admin">
                Panel
              </Link>
            )}
          </nav>
          <form action={logoutAction} className="ml-auto">
            <button className="text-sm text-muted hover:text-ink">Salir</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        {!ctx.barberId ? (
          <Notice tone="warn">
            Tu usuario no está vinculado a un perfil de barbero. Pídeselo al dueño (Usuarios).
          </Notice>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

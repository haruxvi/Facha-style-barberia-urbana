import { redirect } from "next/navigation";
import { ButtonLink, Logo } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Raíz: si se configura DEFAULT_PUBLIC_SLUG (instalación de una sola barbería), redirige a su página.
 */
export default function Home() {
  const slug = process.env.DEFAULT_PUBLIC_SLUG;
  if (slug && /^[a-z0-9-]{2,60}$/.test(slug)) redirect(`/b/${slug}`);
  return (
    <main className="bg-brand flex min-h-dvh items-center justify-center px-4">
      <div className="text-center">
        <Logo />
        <p className="mt-4 text-muted">Plataforma de reservas para barberías.</p>
        <ButtonLink href="/admin" variant="secondary" className="mt-6">
          Acceso del equipo
        </ButtonLink>
      </div>
    </main>
  );
}

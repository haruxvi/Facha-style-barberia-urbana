import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="font-display text-6xl text-accent">404</div>
      <p className="text-muted">No encontramos esta página.</p>
      <ButtonLink href="/" variant="secondary">
        Ir al inicio
      </ButtonLink>
    </main>
  );
}

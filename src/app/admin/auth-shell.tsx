import { Card, Logo } from "@/components/ui";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="bg-brand flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" showName={false} />
        </div>
        <Card className="space-y-5 p-6 shadow-2xl shadow-black/40">
          <div>
            <h1 className="heading-page">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {children}
        </Card>
      </div>
    </main>
  );
}

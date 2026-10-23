import { Card, Logo } from "@/components/ui";

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="bg-stripes flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card className="space-y-5">
          <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}

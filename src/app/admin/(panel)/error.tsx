"use client";

import { Button, Card } from "@/components/ui";

export default function PanelError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="max-w-lg space-y-3">
      <h1 className="font-display text-2xl uppercase">Algo salió mal</h1>
      <p className="text-sm text-muted">
        No pudimos cargar esta sección. Si el problema persiste, revisa que tengas permiso para verla.
      </p>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </Card>
  );
}

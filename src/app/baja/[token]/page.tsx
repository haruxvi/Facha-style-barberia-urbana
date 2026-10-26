import { unsubscribeByToken } from "@/modules/crm";
import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { runAction, type ActionResult } from "@/server/actions";
import { AppError } from "@/shared/errors";

export const metadata = { title: "Darse de baja", robots: { index: false } };

/** La baja requiere un clic (POST): así los antivirus que abren enlaces no dan de baja a nadie. */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  async function unsubscribe(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
    "use server";
    return runAction(async () => {
      const ok = await unsubscribeByToken(token);
      if (!ok) throw new AppError("VALIDATION", "El enlace no es válido.");
      return "Listo: ya no recibirás correos nuestros.";
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4">
        <h1 className="heading-page">Darse de baja</h1>
        <p className="text-sm text-muted">
          Dejarás de recibir correos de confirmación, recordatorios y promociones de esta barbería.
        </p>
        <ActionForm action={unsubscribe} submitLabel="Confirmar baja" variant="danger" />
      </Card>
    </main>
  );
}

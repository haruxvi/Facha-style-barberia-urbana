import { notFound, redirect } from "next/navigation";
import {
  buildFakeEvent,
  getPaymentForSimulator,
  handlePaymentWebhook,
  signFakeEvent,
} from "@/modules/payments";
import { Button, Card, Notice } from "@/components/ui";
import { formatMoney } from "@/shared/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulador de pagos (pruebas)", robots: { index: false } };

/**
 * ⚠️ SIMULADOR DE PAGOS — SOLO DESARROLLO. No existe en producción (404) y no mueve dinero.
 * Envía un webhook firmado al mismo pipeline que usa un proveedor real.
 */
export default async function FakeCheckoutPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const payment = await getPaymentForSimulator(paymentId);
  if (!payment) notFound();

  async function decide(formData: FormData) {
    "use server";
    const p = await getPaymentForSimulator(paymentId);
    if (!p) notFound();
    const status = formData.get("status") === "approved" ? "approved" : "rejected";
    const { body, signature } = signFakeEvent(
      buildFakeEvent({ paymentId: p.id, status, amount: p.amount, currency: p.currency }),
    );
    await handlePaymentWebhook("FAKE", p.tenantId, {
      headers: new Headers({ "x-fake-signature": signature }),
      url: new URL("http://localhost/api/webhooks/fake"),
      rawBody: body,
    });
    redirect(
      `/b/${p.appointment.tenant.slug}/confirmacion/${p.appointment.id}?pago=${status === "approved" ? "ok" : "error"}`,
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card className="space-y-5 border-warn/50">
        <Notice tone="warn">
          <b>SIMULADOR DE PAGOS · ENTORNO DE PRUEBAS.</b> Aquí no se cobra dinero real. En producción esta
          pantalla no existe y el cliente paga en Mercado Pago.
        </Notice>
        <div>
          <div className="text-sm text-muted">{payment.appointment.tenant.name}</div>
          <div className="font-semibold">{payment.appointment.serviceName}</div>
          <div className="font-display text-3xl text-accent">
            {formatMoney(payment.amount, payment.currency)}
          </div>
        </div>
        <form action={decide} className="flex gap-2">
          <Button name="status" value="approved" className="flex-1">
            Simular pago aprobado
          </Button>
          <Button name="status" value="rejected" variant="danger" className="flex-1">
            Simular rechazo
          </Button>
        </form>
      </Card>
    </main>
  );
}

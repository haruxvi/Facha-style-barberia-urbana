import Link from "next/link";
import { can, requireAuth } from "@/modules/identity";
import { listPayments } from "@/modules/payments";
import { ActionForm } from "@/components/action-form";
import { Badge, EmptyState, Input, Notice, PageHeader, PaymentStatusBadge, Table } from "@/components/ui";
import { formatMoney } from "@/shared/money";
import { formatDateTime } from "@/shared/time";
import { reconcileAction, refundAction } from "../../actions";

export const metadata = { title: "Pagos" };

export default async function PaymentsPage() {
  const ctx = await requireAuth("payments.view");
  const payments = await listPayments(ctx);
  const needsRefund = payments.filter((p) => p.requiresRefund);
  const canRefund = can(ctx.role, "payments.refund");

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Un pago solo se aprueba con un webhook auténtico del proveedor y tras consultar su estado real. El regreso del navegador nunca confirma un pago."
      />
      {needsRefund.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {needsRefund.length} pago(s) aprobado(s) de reservas canceladas o expiradas: revisa y reembolsa si
            corresponde.
          </Notice>
        </div>
      )}
      {payments.length === 0 ? (
        <EmptyState>Aún no hay pagos online.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Reserva</th>
              <th>Importe</th>
              <th>Proveedor</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap text-xs">{formatDateTime(p.createdAt, ctx.timezone)}</td>
                <td>
                  <Link href={`/admin/reservas/${p.appointment.id}`} className="hover:text-accent">
                    {p.appointment.customer.name}
                  </Link>
                  <div className="text-xs text-muted">{p.appointment.serviceName}</div>
                </td>
                <td className="whitespace-nowrap">
                  {formatMoney(p.amount, p.currency)}
                  <div className="text-xs text-muted">{p.kind === "DEPOSIT" ? "Seña" : "Total"}</div>
                  {p.refundedAmount > 0 && (
                    <div className="text-xs text-info">−{formatMoney(p.refundedAmount, p.currency)}</div>
                  )}
                </td>
                <td className="text-xs">
                  {p.provider === "FAKE" ? <Badge tone="warn">Simulado (dev)</Badge> : "Mercado Pago"}
                  {p.externalPaymentId && <div className="text-muted">#{p.externalPaymentId}</div>}
                </td>
                <td>
                  <PaymentStatusBadge status={p.status} />
                  {p.requiresRefund && (
                    <div className="mt-1">
                      <Badge tone="danger">Requiere reembolso</Badge>
                    </div>
                  )}
                </td>
                <td className="space-y-2">
                  {["PENDING", "IN_PROCESS"].includes(p.status) && p.provider !== "FAKE" && (
                    <ActionForm action={reconcileAction} submitLabel="Conciliar" variant="ghost" inline>
                      <input type="hidden" name="paymentId" value={p.id} />
                    </ActionForm>
                  )}
                  {canRefund && ["APPROVED", "PARTIALLY_REFUNDED"].includes(p.status) && (
                    <ActionForm
                      action={refundAction}
                      submitLabel="Reembolsar"
                      variant="danger"
                      inline
                      confirm="¿Reembolsar este pago?"
                    >
                      <input type="hidden" name="paymentId" value={p.id} />
                      <Input
                        name="amount"
                        type="number"
                        min={1}
                        max={p.amount - p.refundedAmount}
                        placeholder={`${p.amount - p.refundedAmount}`}
                        className="w-28"
                      />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

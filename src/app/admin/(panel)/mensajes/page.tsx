import Link from "next/link";
import { listCustomers } from "@/modules/crm";
import { requireAuth } from "@/modules/identity";
import { listNotifications, TEMPLATE_VARIABLES } from "@/modules/messaging";
import { getConversation, listConversations } from "@/modules/whatsapp";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  NotificationStatusBadge,
  PageHeader,
  Select,
  Table,
  Textarea,
  cx,
} from "@/components/ui";
import { formatDateTime } from "@/shared/time";
import {
  replyConversationAction,
  resolveHandoffAction,
  retryNotificationAction,
  sendManualMessageAction,
} from "../../actions";

export const metadata = { title: "Mensajes" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string; cliente?: string }>;
}) {
  const ctx = await requireAuth("messages.send");
  const sp = await searchParams;
  const [notifications, conversations, customers] = await Promise.all([
    listNotifications(ctx, { take: 60 }),
    listConversations(ctx),
    listCustomers(ctx, { take: 200 }),
  ]);
  const conversation =
    sp.conv && /^[0-9a-f-]{36}$/.test(sp.conv) ? await getConversation(ctx, sp.conv).catch(() => null) : null;

  return (
    <>
      <PageHeader
        title="Mensajes"
        description="WhatsApp (Cloud API oficial) y correo. Cada envío queda registrado con su estado real."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 heading-section">Nuevo mensaje</h2>
          {customers.length === 0 ? (
            <EmptyState>Aún no hay clientes.</EmptyState>
          ) : (
            <ActionForm action={sendManualMessageAction} submitLabel="Enviar" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Cliente">
                  <Select name="customerId" defaultValue={sp.cliente} required>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.phoneE164}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Canal">
                  <Select name="channel">
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="EMAIL">Correo</option>
                  </Select>
                </Field>
              </div>
              <Field label="Asunto (solo correo)">
                <Input name="subject" />
              </Field>
              <Field
                label="Mensaje"
                hint={`Variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`}
              >
                <Textarea name="body" required defaultValue={"Hola {{customer_name}}, "} />
              </Field>
              <p className="text-xs text-muted">
                WhatsApp solo permite texto libre si el cliente escribió en las últimas 24 h; fuera de esa
                ventana usa plantillas aprobadas por Meta (Automatizaciones).
              </p>
            </ActionForm>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 heading-section">Conversaciones de WhatsApp</h2>
          {conversations.length === 0 ? (
            <EmptyState>Sin conversaciones todavía.</EmptyState>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/mensajes?conv=${c.id}`}
                    className={cx(
                      "flex items-center justify-between gap-2 py-2.5",
                      sp.conv === c.id && "text-accent",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{c.waPhone}</span>
                      <span className="block truncate text-xs text-muted">{c.messages[0]?.body ?? ""}</span>
                    </span>
                    {c.handoff ? <Badge tone="warn">Requiere persona</Badge> : <Badge>Bot</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {conversation && (
        <Card className="mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="heading-section">{conversation.waPhone}</h2>
            {conversation.handoff && (
              <ActionForm
                action={resolveHandoffAction}
                submitLabel="Devolver al bot"
                variant="secondary"
                inline
              >
                <input type="hidden" name="conversationId" value={conversation.id} />
              </ActionForm>
            )}
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg bg-surface-2 p-4">
            {conversation.messages.map((m) => (
              <div
                key={m.id}
                className={cx(
                  "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                  m.direction === "INBOUND" ? "bg-surface" : "ml-auto bg-accent/15",
                )}
              >
                {m.body}
                <div className="mt-1 text-[10px] text-muted">
                  {formatDateTime(m.createdAt, ctx.timezone)} {m.status ? `· ${m.status}` : ""}
                </div>
              </div>
            ))}
          </div>
          <ActionForm
            action={replyConversationAction}
            submitLabel="Responder"
            resetOnSuccess
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="conversationId" value={conversation.id} />
            <Textarea name="body" required placeholder="Escribe tu respuesta…" />
          </ActionForm>
        </Card>
      )}

      <h2 className="mb-3 mt-8 heading-section">Registro de envíos</h2>
      {notifications.length === 0 ? (
        <EmptyState>Sin envíos todavía.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Canal</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {notifications.map((n) => (
              <tr key={n.id}>
                <td className="whitespace-nowrap text-xs">{formatDateTime(n.createdAt, ctx.timezone)}</td>
                <td>{n.customer?.name ?? "Interno"}</td>
                <td>{n.channel === "WHATSAPP" ? "WhatsApp" : "Correo"}</td>
                <td className="text-xs text-muted">
                  {n.trigger === "manual" ? "Manual" : n.trigger}
                  {n.provider?.includes("simulado") || n.provider === "console" ? " · simulado (dev)" : ""}
                </td>
                <td>
                  <NotificationStatusBadge status={n.status} />
                  {n.error && <div className="mt-1 max-w-xs text-xs text-muted">{n.error}</div>}
                </td>
                <td>
                  {n.status === "FAILED" && (
                    <ActionForm
                      action={retryNotificationAction}
                      submitLabel="Reintentar"
                      variant="ghost"
                      inline
                    >
                      <input type="hidden" name="id" value={n.id} />
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

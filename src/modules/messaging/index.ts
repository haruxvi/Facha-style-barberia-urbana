export {
  enqueueNotification,
  sendNotification,
  buildAppointmentVars,
  applyDeliveryStatus,
  sendManualMessage,
  retryNotification,
  listNotifications,
  type EnqueueNotificationInput,
  type Purpose,
} from "./notification-service";
export { listTemplates, saveTemplate, previewTemplate } from "./template-service";
export {
  TEMPLATE_VARIABLES,
  renderTemplate,
  unknownVariables,
  extractVariables,
  orderedValues,
  type TemplateVars,
} from "./templates";
export {
  getEmailProvider,
  getWhatsAppSender,
  setProviderOverrides,
  ProviderError,
  ConsoleEmailProvider,
  ConsoleWhatsAppSender,
  CloudApiWhatsAppSender,
  ResendEmailProvider,
  type EmailProvider,
  type WhatsAppSender,
} from "./providers";

import { getEmailProvider } from "./providers";

/** Correo de plataforma (no ligado a un cliente): recuperación de contraseña, invitaciones. */
export async function sendPlatformEmail(msg: { to: string; subject: string; text: string; html: string }) {
  await getEmailProvider().send(msg);
}

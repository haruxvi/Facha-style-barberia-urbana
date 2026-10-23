# TODO

Estado al cierre de esta sesión: núcleo funcional verificado (lint, typecheck, build, 75 tests de unidad/integración y 8 e2e en verde). Lo siguiente está **pendiente** o **sin validar con proveedores reales**.

## Bloqueado por decisiones o credenciales del cliente

- [ ] **Validar WhatsApp con credenciales reales** (número de prueba de Meta): webhook, plantillas *Utility* aprobadas para confirmación y recordatorio, nombres cargados en Automatizaciones → Plantillas. Guía: `docs/integrations.md`.
- [ ] **Validar Mercado Pago en modo prueba** con usuarios/tarjetas de prueba y la clave secreta de webhooks. Confirmar que `transaction_amount` llega en pesos enteros para CLP.
- [ ] **Resend**: verificar dominio y probar envío real.
- [ ] Crear el repositorio git (el usuario lo hará) y conectar Vercel + Supabase según `docs/deployment.md`.
- [ ] Decidir plan de Vercel o configurar `pg_cron` para procesar la cola cada minuto (recordatorios).

## Funcionalidad pendiente

- [ ] **Lista de espera**: existe el modelo `WaitlistEntry`, falta UI pública ("avísame si se libera"), panel y aviso automático al cancelarse una cita.
- [ ] Webhook de **rebotes/quejas** de Resend (verificación Svix) → `applyDeliveryStatus` + revocar consentimiento ante queja.
- [ ] **Reprogramación por WhatsApp** dentro del bot (hoy envía el enlace seguro de gestión, que sí permite reprogramar).
- [ ] Notificar al dueño (correo interno) cuando un pago queda "requiere reembolso" (hoy: aviso en Pagos + auditoría).
- [ ] Precio por sucursal en la UI de servicios (el modelo `ServiceBranch.priceOverride` ya lo soporta y la API lo respeta).
- [ ] Script de **rotación de `ENCRYPTION_KEY`** (re-cifrar `TenantIntegration.secretsEncrypted`).
- [ ] Suscripciones SaaS (cobro a barberías por usar el software): solo existe el modelo `Subscription`; separado de los pagos de servicios.
- [ ] Interpretación de texto libre con IA en el bot (`IntentInterpreter`, desactivado; ver `docs/architecture.md`).
- [ ] Vista de agenda: arrastrar para reprogramar; creación de reserva desde un hueco de la agenda.
- [ ] Subida de logo/fotos (hoy por URL) — p. ej. Supabase Storage.
- [ ] Página de política de privacidad pública y texto legal revisado (Ley 19.628 / 21.719).

## Calidad y operación

- [ ] Monitoreo de errores (Sentry o similar) y alertas sobre `Job` en `DEAD` y notificaciones en `SENDING` > 10 min.
- [ ] Tests e2e del panel más completos (servicios, horarios, mensajes) y de la gestión por enlace (reprogramar/cancelar).
- [ ] `npm audit`: revisar los avisos reportados por npm al instalar.
- [ ] Endurecer CSP (Content-Security-Policy) cuando estén definidos los dominios externos (Mercado Pago, imágenes).

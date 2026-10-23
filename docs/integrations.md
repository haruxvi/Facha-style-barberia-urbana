# Integraciones externas

Estado honesto: todas están **implementadas y cubiertas por tests con proveedores simulados**, pero **ninguna se validó con credenciales reales**. Sin credenciales, en desarrollo se usan simuladores que lo indican explícitamente (logs `*.simulated`, proveedor "simulado (dev)" en el panel). En producción los simuladores están deshabilitados.

## WhatsApp Business Platform (Cloud API oficial)

Código: `src/modules/whatsapp` (webhook, bot) y `src/modules/messaging/providers.ts` (envío).

1. En [Meta for Developers](https://developers.facebook.com/) crea una app tipo **Business** y añade el producto **WhatsApp**.
2. Datos a copiar:
   - **Phone number ID** → panel → Configuración → WhatsApp (por barbería).
   - **Access token**: para pruebas el temporal; para producción un **System User token** permanente con `whatsapp_business_messaging` → panel (se guarda cifrado).
   - **App Secret** (App settings → Basic) → `WHATSAPP_APP_SECRET`.
   - Inventa un **verify token** → `WHATSAPP_VERIFY_TOKEN`.
3. Webhook: URL `https://TU-DOMINIO/api/webhooks/whatsapp`, verify token el anterior, suscribir el campo **messages**.
4. **Plantillas**: fuera de la ventana de 24 h (confirmaciones y recordatorios iniciados por la barbería) Meta exige plantillas aprobadas. Crea en WhatsApp Manager plantillas de categoría *Utility* con el mismo texto y variables en el mismo orden, y escribe su nombre en Automatizaciones → Plantillas ("Plantilla aprobada en Meta"). Sin plantilla, esos mensajes quedan **FAILED** con el motivo explicado (no se envía texto libre fuera de ventana).
5. Prueba: envía "hola" al número de prueba → el bot responde el menú. Escribe "1" para reservar, "BAJA" para revocar consentimiento, "persona" para derivar.

Tests: `tests/integration/whatsapp.test.ts` (firma válida/inválida, duplicados, tenant por número receptor, flujo completo, hora tomada, derivación, BAJA).

## Mercado Pago (Checkout Pro)

Código: `src/modules/payments/mercadopago.ts` y `payment-service.ts`. Modelo: **cada barbería cobra en su propia cuenta** (sus credenciales, cifradas). No hay split ni marketplace (requiere habilitación y contrato con Mercado Pago; ver TODO).

1. [Tus integraciones](https://www.mercadopago.cl/developers/panel/app) → crea una aplicación (Checkout Pro).
2. Copia el **Access Token de prueba** (`TEST-…` o de usuario de prueba) → panel → Configuración → Mercado Pago.
3. En **Webhooks** de la aplicación: URL `https://TU-DOMINIO/api/webhooks/mercadopago/<tenantId>` (el panel muestra la URL exacta), evento **Pagos**. Copia la **clave secreta** → campo "Clave secreta de webhooks".
4. Política de cobro en Configuración (seña o total). Prueba con [tarjetas de prueba](https://www.mercadopago.cl/developers/es/docs/checkout-pro/integration-test/test-cards) y usuarios de prueba.
5. Verificación implementada: firma `x-signature` (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256) **y** consulta `GET /v1/payments/{id}`; se valida referencia (`external_reference` = id interno), barbería, importe, moneda y antigüedad del estado.
6. Retorno del navegador: la página de confirmación **consulta al proveedor** desde el servidor; el parámetro `?pago=ok` no confirma nada.
7. Conciliación: botón "Conciliar" en Pagos y tarea diaria para pagos pendientes de 5 min a 48 h.

Tests: `tests/integration/payments.test.ts` (aprobado, rechazado, firma inválida, duplicado, fuera de orden, importe/moneda incorrectos, otra barbería, cancelada durante el pago, reembolso, hold vencido, conciliación, firma MP oficial).

## Otros proveedores de pagos

Decisión del cliente: **solo Mercado Pago**. Si en el futuro se quisiera otro, basta implementar la interfaz `PaymentGateway` (`src/modules/payments/gateway.ts`), añadirlo al enum `PaymentProvider` (migración), registrarlo en `getGateway()`/`availableProvider()` y crear su ruta de webhook.

## Correo transaccional (Resend)

Código: `src/modules/messaging/providers.ts` (`EmailProvider`, `ResendEmailProvider`, `ConsoleEmailProvider`).

1. Crea una cuenta en [Resend](https://resend.com), verifica tu dominio (SPF/DKIM).
2. Variables: `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM="Facha Style <reservas@tudominio.cl>"`.
3. Se envía con `Idempotency-Key` = id de la notificación (sin duplicados ante reintentos).
4. Cada correo a clientes incluye un enlace de baja (`/baja/<token>`, requiere un clic para confirmar).
5. Pendiente: webhook de rebotes/quejas de Resend → `applyDeliveryStatus` (ver TODO). El sistema nunca marca un correo como "leído".

Otros proveedores (Postmark, SES): implementar `EmailProvider` y elegirlo en `getEmailProvider()`.

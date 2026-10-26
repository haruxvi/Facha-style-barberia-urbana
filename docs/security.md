# Seguridad y protección de datos

## Implementado (y dónde)

| Control | Implementación |
|---|---|
| Autenticación solo para el personal | `modules/identity`: scrypt (N=2¹⁵), sesiones con token aleatorio de 256 bits guardado como SHA-256, cookie `__Host-` HttpOnly + Secure + SameSite=Lax en producción |
| Expiración / revocación | 12 h de inactividad, 7 días absolutos; cerrar sesión, desactivar miembro o cambiar contraseña revoca sesiones |
| Fuerza bruta | Rate limit por IP y por correo (Postgres) + bloqueo 15 min tras 5 fallos; mensajes genéricos y tiempo constante si el usuario no existe |
| Recuperación de contraseña / invitaciones | Tokens de un solo uso, hasheados, con expiración (30 min / 7 días); reclamo atómico |
| Autorización | RBAC por operación (`identity/rbac.ts`) comprobado **en el servidor** en cada página, acción y servicio; el barbero solo ve sus citas (filtro forzado) |
| Aislamiento entre barberías | Tenant sale de la sesión (revalidado contra la membresía) o del slug público; todas las consultas filtran por `tenantId`; FK compuestas en la BD; tests dedicados |
| IDOR | Recursos se buscan siempre por `(id, tenantId)`; inexistente o ajeno → 404 igual |
| CSRF | Server Actions de Next validan `Origin`; cookies SameSite=Lax; las API públicas no usan cookies de sesión |
| XSS | React escapa por defecto; plantillas: variables en lista blanca, escape HTML en correos y limpieza de caracteres de control en WhatsApp |
| SQL injection | Prisma parametrizado; las pocas consultas crudas usan `$queryRaw` con plantillas parametrizadas |
| Validación de entradas | Zod en servidor para todo; límites de tamaño de cuerpo en API y webhooks |
| Precio / disponibilidad / pago | Siempre decididos por el servidor; campos extra del navegador se ignoran (probado) |
| Webhooks | WhatsApp: `X-Hub-Signature-256` con App Secret. Mercado Pago: `x-signature` (HMAC) con el secreto de esa barbería + consulta del pago en la API. Idempotencia por evento |
| Secretos de integraciones | Cifrados con AES-256-GCM (`ENCRYPTION_KEY`), nunca se devuelven a la UI |
| Logs | JSON estructurado; se redactan claves sensibles y se enmascaran teléfonos/correos |
| Cabeceras | HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy; `no-referrer` + `noindex` + `no-store` en gestión de reservas |
| Auditoría | `AuditLog`: login, cambios de configuración, integraciones, miembros, reembolsos, consentimientos, exportación/anonimización |
| API REST de Supabase | RLS activado sin políticas → `anon`/`authenticated` no leen nada |
| Consentimiento | Por canal (WhatsApp/correo) y finalidad (reservas/promociones), revocable (panel, "BAJA" por WhatsApp, enlace de baja por correo); se revalida al enviar |
| Derechos sobre los datos | Exportación JSON por cliente y anonimización (conserva citas sin datos personales) |

## Modo demo local (`DEMO_MODE`)

Lo usa `docker-compose.yml` para mostrar la app compilada en producción sobre `http://localhost`. Activa: cookies sin `Secure` (necesario en http), WhatsApp/correo simulados y el simulador de pagos.

Salvaguardas:
- La app **no arranca** si `DEMO_MODE=true` y `APP_URL` no es local (localhost, `*.local` o IP privada 10/172.16/192.168). Un despliegue público con esa variable falla al iniciar.
- Los secretos del compose son públicos a propósito y solo sirven para la demo; nunca reutilizarlos.
- Vercel/producción: no definir `DEMO_MODE` ni `PAYMENTS_FAKE_ENABLED`.

## Checklist antes de producción

- [ ] `SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` generados al azar y **distintos** en Preview y Production.
- [ ] `APP_URL` con `https://` y dominio definitivo.
- [ ] `PAYMENTS_FAKE_ENABLED` y `DEMO_MODE` sin definir (el simulador además está bloqueado en producción salvo la demo local).
- [ ] Primer dueño creado con `npm run owner:create` (nunca con el seed).
- [ ] Supabase: contraseña de BD fuerte, backups activos (PITR si el plan lo permite), "Network restrictions" si aplica.
- [ ] Webhooks de Meta y Mercado Pago apuntando a producción, con sus secretos.
- [ ] Probar restauración de un backup (ver `deployment.md`).
- [ ] `npm audit` y actualización de dependencias.
- [ ] Revisar textos legales: aviso de privacidad y condiciones de reserva (Ley 19.628 y la nueva Ley 21.719 de Chile).

## Rotación de claves

- `SESSION_SECRET`: invalida **todas** las sesiones y todos los enlaces de gestión enviados. Hacerlo si se sospecha filtración.
- `ENCRYPTION_KEY`: requiere re-cifrar `TenantIntegration.secretsEncrypted` (no hay script aún → reingresar credenciales en el panel). Ver TODO.

## Retención de datos (propuesta, configurar con el cliente)

- Citas y pagos: mientras exista obligación contable (Chile: 6 años).
- Mensajes de WhatsApp de conversación: 12 meses.
- Sesiones, rate limits, jobs completados: limpieza automática diaria (7–30 días).
- Clientes que piden supresión: anonimización inmediata desde el panel.

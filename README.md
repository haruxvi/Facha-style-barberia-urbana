# Facha & Style · Plataforma de reservas para barberías

Plataforma SaaS (multi-barbería) para **Facha & Style, barbería urbana**, preparada para sumar más barberías.

- **Clientes**: reservan **sin cuenta** desde un QR o link → eligen servicio, profesional, día y hora → reciben confirmación por WhatsApp/correo → gestionan su reserva con un enlace seguro. También pueden reservar conversando con el **bot de WhatsApp**.
- **Equipo**: panel privado con agenda, reservas, clientes (CRM), mensajes, automatizaciones, pagos, reportes, QR, usuarios y permisos. Portal propio para barberos.

> Estado: base funcional verificada (77 tests de integración/unidad + 8 e2e). Las integraciones externas (WhatsApp, Mercado Pago, correo) están implementadas pero **no validadas con credenciales reales**: ver [docs/integrations.md](docs/integrations.md) y [TODO.md](TODO.md).

## Stack

| Pieza | Elección | Por qué |
|---|---|---|
| App | **Next.js 16** (App Router, Server Actions, route handlers) + React 19 + Tailwind 4 | Un solo despliegue en Vercel |
| Datos | **PostgreSQL** (Supabase en prod, Docker en local) + **Prisma 7** (adapter `pg`) | Migraciones versionadas, restricciones fuertes |
| Cola / cron | Tabla `Job` en Postgres (outbox) + **Vercel Cron** / `pg_cron` | Sin Redis: menos piezas que mantener |
| Auth | Sesiones propias (cookie HttpOnly, token hasheado), scrypt, RBAC por barbería | Solo el personal tiene cuenta |
| Pagos | Interfaz `PaymentGateway` + adaptador **Mercado Pago** (+ simulador solo dev) | |
| WhatsApp | **Cloud API oficial** de Meta | Sin librerías no oficiales |
| Correo | Interfaz `EmailProvider` + **Resend** (+ consola en dev) | |
| Tests | Vitest (contra Postgres real) + Playwright | |

Desviaciones del plan original (NestJS, BullMQ/Redis, monorepo pnpm) y su justificación: [docs/architecture.md](docs/architecture.md).

## Demo en 1 comando (Docker)

Solo necesitas [Docker](https://www.docker.com/products/docker-desktop/). Levanta la base de datos, aplica las migraciones, carga datos de demostración y arranca la app compilada en modo producción:

```bash
docker compose up --build
```

| Qué | URL |
|---|---|
| Página pública de la barbería | http://localhost:8080 |
| Panel de administración | http://localhost:8080/admin |

**Usuarios de la demo** (solo existen en esta demo local; en un despliegue real se crean con `npm run owner:create`):

| Rol | Correo | Contraseña |
|---|---|---|
| Dueño | `dueno@facha.dev` | `FachaDev2026` |
| Recepción | `recepcion@facha.dev` | `FachaDev2026` |
| Barbero (portal propio) | `nico@facha.dev` | `FachaDev2026` |

En la demo (`DEMO_MODE=true`) WhatsApp y el correo se **simulan** (quedan en el registro de mensajes) y los pagos online abren un **simulador** claramente marcado; no se mueve dinero. La app se niega a arrancar con `DEMO_MODE` si `APP_URL` no es local, para que nunca quede activo en producción.

Por defecto la demo solo responde en tu propio computador. Para abrirla desde un celular en la misma red Wi-Fi (y escanear los QR) hay que permitirlo explícitamente; tu IP se pasa solo en la terminal, nunca se guarda en el repo:

```bash
DEMO_BIND=0.0.0.0 DEMO_APP_URL=http://IP-DE-TU-PC:8080 docker compose up -d
```

Apagar: `docker compose down` (agrega `-v` para borrar también los datos de la demo).

## Puesta en marcha local

Requisitos: Node 20.19+ (probado con 24), Docker.

```bash
npm install
cp .env.example .env          # y completa SESSION_SECRET, ENCRYPTION_KEY, CRON_SECRET (comandos en el archivo)
npm run db:up                 # Postgres 17 en 127.0.0.1:5433 (+ base facha_test)
npm run db:deploy             # aplica migraciones
npm run db:seed               # datos de DESARROLLO (barbería "facha-style", ficticia)
npm run dev                   # http://localhost:3000
```

- Página pública: http://localhost:3000/b/facha-style (QR de prueba: `?c=espejo`)
- Panel: http://localhost:3000/admin · usuarios de desarrollo en `prisma/seed.ts` (solo local)
- En desarrollo WhatsApp/correo se **simulan** (se registran en el log, marcados como simulados) y los pagos usan un **simulador** que no existe en producción.

Apagar: `npm run db:down` (los datos persisten en el volumen `pgdata`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run check` | lint + typecheck + tests |
| `npm test` | Vitest (unidad + integración contra `TEST_DATABASE_URL`, que se vacía) |
| `npm run test:e2e` | Playwright (requiere `npm run dev` con seed; usa Edge/Chrome instalado) |
| `npm run db:migrate` | crea una migración nueva en desarrollo |
| `npm run db:deploy` | aplica migraciones (lo que corre en producción) |
| `npm run owner:create` | crea de forma segura la primera barbería y su dueño |

## Estructura (monolito modular)

```
src/
  app/            capa de entrega: páginas, Server Actions y API (no toca la BD directamente)
  server/         raíz de composición: conecta módulos (caso de uso de reserva, worker, puertos del bot)
  modules/        dominio, cada uno con su API pública en index.ts
    identity  tenancy  catalog  scheduling  booking  crm
    messaging automation  whatsapp  payments  reporting  jobs
  shared/         db, env, errores, tiempo/zonas horarias, dinero, teléfono, cripto, logger, rate limit
prisma/           schema, migraciones versionadas, seed de desarrollo
tests/            unit, integration (Postgres real), e2e (Playwright)
infra/            docker-compose (solo local)
docs/             arquitectura, seguridad, despliegue, integraciones, modelo de datos
```

## Documentación

- [Arquitectura](docs/architecture.md) · [Modelo de datos y estados](docs/data-model.md)
- [Seguridad y checklist](docs/security.md)
- [Despliegue en Vercel + Supabase, backups y recuperación](docs/deployment.md)
- [Integraciones: WhatsApp, Mercado Pago, correo](docs/integrations.md)
- [Pendientes](TODO.md)

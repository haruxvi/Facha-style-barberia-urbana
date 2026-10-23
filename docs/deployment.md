# Despliegue: Vercel + Supabase

## 1. Supabase (base de datos)

1. Crea un proyecto en la región **South America (São Paulo) `sa-east-1`**: `vercel.json` fija las funciones en `gru1` (São Paulo) para que app y base queden juntas.
2. En **Project Settings → Database → Connection string** copia:
   - **Transaction pooler** (puerto **6543**) → `DATABASE_URL`. Con el adapter `pg` de Prisma 7 no hacen falta `pgbouncer=true` ni `connection_limit`: el pool se limita en `src/shared/db.ts` (3 conexiones por instancia en Vercel).
   - **Session pooler** (puerto **5432**, host `…pooler.supabase.com`) → `DIRECT_URL` (lo usan las migraciones). **No** uses la conexión "Direct" (`db.<ref>.supabase.co`): es solo IPv6 y el build de Vercel no tiene IPv6, así que `prisma migrate deploy` fallaría.
3. La migración inicial ya crea la extensión `btree_gist` y activa RLS sin políticas.

No uses el cliente `supabase-js` ni la API REST para estos datos: la app accede solo por Prisma.

## 2. Vercel (app)

1. Importa el repositorio (cuando lo crees en GitHub). Framework: Next.js. Vercel usará `npm run vercel-build`, que ejecuta `prisma migrate deploy` antes del build.
2. Variables de entorno (Production y Preview, **valores distintos**): todas las de `.env.example`.
   - `APP_URL=https://tu-dominio`
   - `NODE_ENV` lo define Vercel; **no** definas `PAYMENTS_FAKE_ENABLED`.
   - `DEFAULT_PUBLIC_SLUG=facha-style` si quieres que la raíz redirija a la barbería.
3. Despliega y crea el primer dueño desde tu equipo apuntando a la BD de producción:
   ```bash
   DATABASE_URL="<direct url de prod>" npm run owner:create
   ```
4. Entra a `/admin`, crea la sucursal, servicios, barberos y horarios. Descarga los QR en Configuración.

### Cron (recordatorios y cola)

- `vercel.json` programa `/api/cron/daily` una vez al día (funciona en el plan **Hobby**, que solo permite crons diarios).
- Para recordatorios puntuales necesitas procesar la cola **cada minuto**:
  - **Vercel Pro**: añade a `vercel.json` `{ "path": "/api/cron/jobs", "schedule": "* * * * *" }`.
  - **Gratis con Supabase** (`pg_cron` + `pg_net`, activar en Database → Extensions):
    ```sql
    select cron.schedule('facha-jobs', '* * * * *', $$
      select net.http_get(
        url := 'https://TU-DOMINIO/api/cron/jobs',
        headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET')
      );
    $$);
    ```
- Las confirmaciones se envían al instante igualmente (`after()` tras crear la reserva).

## 3. Migraciones

- Desarrollo: `npm run db:migrate -- --name descripcion` crea una migración nueva en `prisma/migrations/`.
- Producción: **solo** `prisma migrate deploy` (lo hace `vercel-build`). Nunca `prisma db push`.
- Restricciones que Prisma no expresa (exclusión, CHECK, RLS) se escriben a mano en el SQL de la migración.

## 4. Copias de seguridad y recuperación

- Supabase hace backups diarios (Pro: 7 días; PITR opcional). Además, un respaldo lógico propio semanal:
  ```bash
  pg_dump "$DIRECT_URL" --format=custom --no-owner --file=facha-$(date +%F).dump
  ```
  Guárdalo cifrado fuera de Supabase.
- **Prueba de restauración** (trimestral): restaura en una base vacía local y corre los tests de humo:
  ```bash
  createdb facha_restore && pg_restore --no-owner -d facha_restore facha-AAAA-MM-DD.dump
  DATABASE_URL=postgresql://.../facha_restore npx prisma migrate status
  ```
- Recuperación ante incidente: (1) poner la app en mantenimiento (desactivar el dominio o un deploy con página estática), (2) restaurar el backup/PITR, (3) `prisma migrate deploy`, (4) revisar `Job` en estado `SENDING`/`DEAD` y pagos `PENDING` (conciliar desde el panel), (5) reactivar.

## 5. Desarrollo local sin Docker

Puedes usar un proyecto Supabase de desarrollo: pon su conexión en `DATABASE_URL`/`DIRECT_URL`. Para los tests usa **otra** base (`TEST_DATABASE_URL`), porque se vacía en cada ejecución.

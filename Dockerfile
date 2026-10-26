# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# Facha & Style · imagen de la app (Next.js standalone)
#   builder → instala dependencias, genera Prisma y compila (también corre migraciones + seed de demo)
#   runner  → imagen mínima de producción, usuario sin privilegios
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
# openssl: requerido por el motor de migraciones de Prisma en Alpine
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
COPY . .
# Valores ficticios SOLO para compilar (no hay conexión a la BD durante el build).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build \
    APP_URL=http://localhost:3000 \
    SESSION_SECRET=build-only-session-secret-not-used-at-runtime \
    ENCRYPTION_KEY=YnVpbGQtb25seS1rZXktMzItYnl0ZXMtbG9uZyEhISE= \
    CRON_SECRET=build-only-cron-secret
RUN npx prisma generate && npx next build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

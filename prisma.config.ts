import "dotenv/config";
import { defineConfig } from "prisma/config";

// Las migraciones usan la conexión directa (en Supabase, DIRECT_URL = puerto 5432 sin pooler).
// En local DIRECT_URL puede omitirse y se usa DATABASE_URL.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url: url ?? "" },
});

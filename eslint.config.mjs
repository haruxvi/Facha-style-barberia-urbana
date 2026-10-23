import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Reglas de arquitectura del monolito modular:
 * - La capa de entrega (src/app) no accede a la base de datos: usa la API pública de cada módulo.
 * - Fuera de un módulo solo se importa su index (`@/modules/<modulo>`), nunca archivos internos.
 */
const layering = {
  files: ["src/app/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/shared/db", "@/generated/prisma/client", "@/generated/prisma/models/*", "@/generated/prisma/internal/*"],
            message: "La capa app no accede a la BD: usa un módulo.",
          },
          { group: ["@/modules/*/*"], message: "Importa solo la API pública del módulo: @/modules/<modulo>." },
        ],
      },
    ],
  },
};

const config = [
  ...nextVitals,
  ...nextTs,
  layering,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "src/generated/**", "playwright-report/**", "next-env.d.ts"],
  },
];

export default config;

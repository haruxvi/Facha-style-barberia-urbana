import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app con el seed de desarrollo (npm run db:seed).
 * Local: usa un navegador ya instalado (PW_CHANNEL; por defecto Edge en Windows, Chrome en el resto),
 * sin descargar nada. CI: Chromium de Playwright (npx playwright install --with-deps chromium).
 */
const channel = process.env.CI
  ? undefined
  : (process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chrome"));
const browser = channel ? { channel } : {};
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  // Un solo worker: los proyectos (escritorio/móvil) reservan contra la misma agenda.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...browser,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], ...browser } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...browser } },
  ],
  // Con E2E_BASE_URL (p. ej. la demo Docker en :8080) se prueba esa instancia; si no, levanta `npm run dev`.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});

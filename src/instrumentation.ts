/** Se ejecuta una vez al arrancar el servidor: falla rápido si falta configuración obligatoria. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/shared/env");
    env();
  }
}

/**
 * Alta segura del primer dueño y su barbería (para producción).
 *
 *   npm run owner:create
 *
 * Pide los datos por consola. La contraseña la escribe la persona que ejecuta el script
 * (o se pasa en OWNER_PASSWORD para entornos no interactivos); nunca hay contraseñas por defecto.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createOwnerUser, createTenant } from "@/modules/identity";
import { db } from "@/shared/db";

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async (q: string, envKey: string) => process.env[envKey] || (await rl.question(q)).trim();
  try {
    const tenantName = await ask("Nombre de la barbería: ", "TENANT_NAME");
    const slug = await ask("Identificador para la URL (ej. facha-style): ", "TENANT_SLUG");
    const name = await ask("Nombre del dueño: ", "OWNER_NAME");
    const email = await ask("Correo del dueño: ", "OWNER_EMAIL");
    const password = await ask("Contraseña (mín. 10 caracteres, letras y números): ", "OWNER_PASSWORD");
    const user = await createOwnerUser({ email, name, password });
    const tenant = await createTenant({ name: tenantName, slug, ownerUserId: user.id });
    console.log(`\n✔ Barbería "${tenantName}" creada (/b/${tenant.slug}) con su dueño ${email}.`);
    console.log("  Siguiente paso: entra a /admin y configura sucursales, servicios, barberos y horarios.");
  } finally {
    rl.close();
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});

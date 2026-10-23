import { z } from "zod";
import { AppError } from "./errors";

/** Valida con Zod y traduce el fallo a un AppError VALIDATION con el primer mensaje legible. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const field = first?.path.join(".");
  throw new AppError("VALIDATION", first?.message ?? "Datos inválidos", {
    field,
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

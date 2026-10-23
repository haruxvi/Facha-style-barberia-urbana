import { notFound } from "next/navigation";
import { isAppError } from "@/shared/errors";

/** En páginas: un recurso inexistente (o de otra barbería) responde 404, no 500. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

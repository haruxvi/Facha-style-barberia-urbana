import type { Role } from "@/generated/prisma/enums";

/**
 * Permisos por operación. La autorización SIEMPRE se comprueba en el servidor;
 * ocultar botones en la UI es solo comodidad.
 */
export const PERMISSIONS = {
  "dashboard.view": ["OWNER", "ADMIN", "RECEPTIONIST"],
  "agenda.view": ["OWNER", "ADMIN", "RECEPTIONIST"],
  "appointments.manage": ["OWNER", "ADMIN", "RECEPTIONIST"],
  "customers.view": ["OWNER", "ADMIN", "RECEPTIONIST"],
  "customers.manage": ["OWNER", "ADMIN"],
  "catalog.manage": ["OWNER", "ADMIN"],
  "barbers.manage": ["OWNER", "ADMIN"],
  "branches.manage": ["OWNER", "ADMIN"],
  "messages.send": ["OWNER", "ADMIN", "RECEPTIONIST"],
  "automations.manage": ["OWNER", "ADMIN"],
  "payments.view": ["OWNER", "ADMIN"],
  "payments.refund": ["OWNER"],
  "reports.view": ["OWNER", "ADMIN"],
  "settings.manage": ["OWNER"],
  "integrations.manage": ["OWNER"],
  "users.manage": ["OWNER"],
  // Portal del barbero: solo sus propias citas (el filtro por barberId se aplica en los servicios)
  "barber.portal": ["BARBER", "OWNER", "ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Dueño",
  ADMIN: "Administrador",
  BARBER: "Barbero",
  RECEPTIONIST: "Recepción",
};

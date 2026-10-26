"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";

export type NavGroup = { group: string; items: { href: string; label: string }[] };

function isActive(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname.startsWith(href);
}

function Groups({ groups, root }: { groups: NavGroup[]; root: string }) {
  const pathname = usePathname();
  return (
    <div className="space-y-7">
      {groups.map((g) => (
        <div key={g.group}>
          {groups.length > 1 && <div className="eyebrow mb-2 px-3 text-subtle">{g.group}</div>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(pathname, it.href, root);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "relative block rounded-md px-3 py-2 text-sm transition-colors duration-150",
                      active
                        ? "bg-surface-2 font-medium text-ink before:absolute before:inset-y-2 before:left-0 before:w-px before:bg-accent"
                        : "text-muted hover:bg-surface-2/60 hover:text-ink",
                    )}
                  >
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Navegación vertical del panel: lista agrupada en escritorio. */
export function SideNav({ groups, root }: { groups: NavGroup[]; root: string }) {
  return (
    <nav aria-label="Secciones">
      <Groups groups={groups} root={root} />
    </nav>
  );
}

/** En pantallas angostas: menú desplegable vertical (se cierra al navegar). */
export function MobileNav({ groups, root }: { groups: NavGroup[]; root: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  const current = groups.flatMap((g) => g.items).find((it) => isActive(pathname, it.href, root));

  return (
    <details ref={ref} className="group border-t border-line-soft">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm">
        <span>
          <span className="text-subtle">Sección · </span>
          <span className="font-medium">{current?.label ?? "Menú"}</span>
        </span>
        <span className="text-xs text-muted group-open:hidden">Abrir menú</span>
        <span className="hidden text-xs text-muted group-open:inline">Cerrar</span>
      </summary>
      <nav aria-label="Secciones" className="pb-4">
        <Groups groups={groups} root={root} />
      </nav>
    </details>
  );
}

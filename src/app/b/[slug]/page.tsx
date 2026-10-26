import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listPublicBarbers, listPublicServices } from "@/modules/catalog";
import { getBranchOpeningHours } from "@/modules/scheduling";
import { getPublicTenant, recordCampaignVisit } from "@/modules/tenancy";
import {
  IconArrowRight,
  IconBolt,
  IconClock,
  IconInstagram,
  IconMapPin,
  IconPhone,
  IconShield,
  IconCalendar,
} from "@/components/icons";
import { ButtonLink, Logo } from "@/components/ui";
import { formatMoney } from "@/shared/money";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await getPublicTenant((await params).slug);
  if (!tenant) return { title: { absolute: "Barbería" } };
  return {
    title: { absolute: `${tenant.name} · Reserva tu hora` },
    description: tenant.description ?? `Reserva tu hora en ${tenant.name} en segundos, sin crear cuenta.`,
  };
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export default async function BarbershopPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { c } = await searchParams;
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();
  const campaign = c && /^[a-z0-9-]{1,40}$/.test(c) ? c : null;
  await recordCampaignVisit(tenant.id, tenant.timezone, campaign);

  const branch = tenant.branches[0];
  const [services, barbers, hours] = branch
    ? await Promise.all([
        listPublicServices(tenant.id, branch.id),
        listPublicBarbers(tenant.id, branch.id),
        getBranchOpeningHours(tenant.id, branch.id),
      ])
    : [[], [], []];

  const reserve = (serviceId?: string) => {
    const qs = new URLSearchParams();
    if (campaign) qs.set("c", campaign);
    if (serviceId) qs.set("servicio", serviceId);
    const s = qs.toString();
    return `/b/${tenant.slug}/reservar${s ? `?${s}` : ""}`;
  };
  const cancelHours = Math.round(tenant.cancellationWindowMinutes / 60);
  const instagram = tenant.instagram?.replace(/^@/, "");

  return (
    <div className="bg-brand min-h-dvh pb-24 sm:pb-0">
      {/* Barra superior: marca + acción principal siempre visibles */}
      <header className="sticky top-0 z-20 border-b border-line-soft bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Logo name={tenant.name} logoUrl={tenant.logoUrl} size="sm" />
          {/* En móvil la acción vive en la barra inferior (zona del pulgar) */}
          <span className="hidden sm:block">
            <ButtonLink href={reserve()}>Reservar hora</ButtonLink>
          </span>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 pt-12 pb-16 text-center sm:pt-16">
          {tenant.logoUrl && (
            <div className="mb-8 flex justify-center">
              <Logo name={tenant.name} logoUrl={tenant.logoUrl} size="xl" showName={false} />
            </div>
          )}
          {/* Sin logo, el rótulo da contexto; con logo sería redundante (la insignia ya lo dice). */}
          {!tenant.logoUrl && <div className="eyebrow mb-4 text-accent">{tenant.name}</div>}
          <h1 className="heading-hero mx-auto max-w-2xl text-balance">Tu estilo, en buenas manos.</h1>
          {tenant.description && (
            <p className="mx-auto mt-5 max-w-xl text-balance leading-relaxed text-muted">
              {tenant.description}
            </p>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href={reserve()} className="px-7 text-base">
              Reservar hora <IconArrowRight />
            </ButtonLink>
            <ButtonLink href="#servicios" variant="secondary" className="px-7 text-base">
              Ver servicios y precios
            </ButtonLink>
          </div>
          <ul className="mx-auto mt-10 flex max-w-2xl flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-muted">
            <li className="flex items-center gap-2">
              <IconBolt className="size-4 text-subtle" /> Reserva en menos de un minuto
            </li>
            <li className="flex items-center gap-2">
              <IconShield className="size-4 text-subtle" /> Sin crear cuenta
            </li>
            {cancelHours > 0 && (
              <li className="flex items-center gap-2">
                <IconCalendar className="size-4 text-subtle" /> Cambia o cancela hasta {cancelHours} h antes
              </li>
            )}
          </ul>
        </section>

        <div className="rule-gold mx-auto max-w-5xl" />

        {/* Servicios */}
        {services.length > 0 && (
          <section id="servicios" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-16">
            <div className="mb-8 text-center">
              <div className="eyebrow text-accent">Carta de servicios</div>
              <h2 className="heading-page mt-3">Servicios y precios</h2>
            </div>
            <ul className="grid gap-x-10 sm:grid-cols-2">
              {services.map((s) => (
                <li key={s.id} className="border-b border-line-soft">
                  <Link
                    href={reserve(s.id)}
                    className="group flex items-start gap-4 py-5 transition-colors duration-150"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-3">
                        <span className="font-display text-lg font-semibold tracking-tight group-hover:text-accent">
                          {s.name}
                        </span>
                        <span
                          aria-hidden
                          className="mb-1 hidden flex-1 border-b border-dotted border-line sm:block"
                        />
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                        <IconClock className="size-3.5" /> {s.durationMinutes} min
                        {s.description ? <span className="text-subtle">· {s.description}</span> : null}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-display text-lg font-semibold tabular-nums text-accent">
                        {formatMoney(s.priceAmount, tenant.currency)}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-subtle group-hover:text-ink">
                        Reservar <IconArrowRight className="size-3" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Equipo */}
        {barbers.length > 0 && (
          <section className="border-y border-line-soft bg-surface/50">
            <div className="mx-auto max-w-5xl px-4 py-16">
              <div className="mb-8 text-center">
                <div className="eyebrow text-accent">El equipo</div>
                <h2 className="heading-page mt-3">Quién te atiende</h2>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {barbers.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start gap-4 rounded-xl border border-line-soft bg-bg p-5"
                  >
                    {b.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.photoUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span
                        aria-hidden
                        className="flex size-14 shrink-0 items-center justify-center rounded-full border border-accent/40 font-display text-xl text-accent"
                      >
                        {b.displayName.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block font-display text-lg font-semibold tracking-tight">
                        {b.displayName}
                      </span>
                      {b.bio && (
                        <span className="mt-1 block text-sm leading-relaxed text-muted">{b.bio}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Visítanos */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="mb-8 text-center">
            <div className="eyebrow text-accent">Visítanos</div>
            <h2 className="heading-page mt-3">Dónde y cuándo</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {tenant.branches.map((b) => (
              <div key={b.id} className="rounded-xl border border-line bg-surface p-6">
                <h3 className="heading-section">{b.name}</h3>
                <ul className="mt-4 space-y-3 text-sm">
                  {b.address && (
                    <li className="flex gap-3">
                      <IconMapPin className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <span>
                        {b.address}
                        <a
                          href={mapsUrl(b.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block text-accent hover:underline"
                        >
                          Cómo llegar
                        </a>
                      </span>
                    </li>
                  )}
                  {(b.phone || tenant.publicPhone) && (
                    <li className="flex gap-3">
                      <IconPhone className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <a
                        href={`tel:${(b.phone ?? tenant.publicPhone)!.replace(/\s/g, "")}`}
                        className="hover:text-accent"
                      >
                        {b.phone ?? tenant.publicPhone}
                      </a>
                    </li>
                  )}
                  {instagram && (
                    <li className="flex gap-3">
                      <IconInstagram className="mt-0.5 size-4 shrink-0 text-subtle" />
                      <a
                        href={`https://instagram.com/${encodeURIComponent(instagram)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent"
                      >
                        @{instagram}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            ))}
            {hours.length > 0 && (
              <div className="rounded-xl border border-line bg-surface p-6">
                <h3 className="heading-section flex items-center gap-2">Horario de atención</h3>
                <dl className="mt-4 divide-y divide-line-soft text-sm">
                  {hours.map((h) => (
                    <div key={h.days} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-muted">{h.days}</dt>
                      <dd className={h.hours === "Cerrado" ? "text-subtle" : "tabular-nums"}>{h.hours}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-xs text-subtle">
          <span>
            © {new Date().getFullYear()} {tenant.name}
          </span>
          <Link href="/admin" className="hover:text-muted">
            Acceso del equipo
          </Link>
        </div>
      </footer>

      {/* Acción principal al alcance del pulgar en el celular */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <ButtonLink href={reserve()} className="w-full text-base">
          Reservar hora <IconArrowRight />
        </ButtonLink>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPublicServices } from "@/modules/catalog";
import { getPublicTenant, recordCampaignVisit } from "@/modules/tenancy";
import { ButtonLink, Card, Logo } from "@/components/ui";
import { formatMoney } from "@/shared/money";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await getPublicTenant((await params).slug);
  return { title: { absolute: tenant ? `${tenant.name} · Reserva online` : "Barbería" } };
}

export default async function BarbershopPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { c } = await searchParams;
  const tenant = await getPublicTenant(slug);
  if (!tenant) notFound();
  const campaign = c && /^[a-z0-9-]{1,40}$/.test(c) ? c : null;
  await recordCampaignVisit(tenant.id, tenant.timezone, campaign);
  const firstBranch = tenant.branches[0];
  const services = firstBranch ? await listPublicServices(tenant.id, firstBranch.id) : [];
  const reserveHref = `/b/${tenant.slug}/reservar${campaign ? `?c=${campaign}` : ""}`;

  return (
    <main className="bg-stripes min-h-dvh">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <header className="mb-10">
          <Logo name={tenant.name} />
          <h1 className="mt-6 font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-6xl">
            Tu corte,
            <br />
            <span className="text-accent">a tu hora.</span>
          </h1>
          {tenant.description && <p className="mt-4 max-w-xl text-muted">{tenant.description}</p>}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={reserveHref} className="px-6 py-3 text-base">
              Reservar ahora
            </ButtonLink>
            <span className="text-sm text-muted">Sin crear cuenta · Confirmación por WhatsApp</span>
          </div>
        </header>

        {services.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-4 font-display text-xl uppercase tracking-wider text-muted">Servicios</h2>
            <div className="divide-y divide-line rounded-xl border border-line bg-surface">
              {services.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-sm text-muted">
                      {s.durationMinutes} min{s.description ? ` · ${s.description}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 font-display text-lg text-accent">
                    {formatMoney(s.priceAmount, tenant.currency)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          {tenant.branches.map((b) => (
            <Card key={b.id}>
              <div className="font-display text-lg uppercase tracking-wide">{b.name}</div>
              {b.address && <p className="mt-1 text-sm text-muted">{b.address}</p>}
              {b.phone && <p className="text-sm text-muted">{b.phone}</p>}
            </Card>
          ))}
          {(tenant.publicPhone || tenant.instagram) && (
            <Card>
              <div className="font-display text-lg uppercase tracking-wide">Contacto</div>
              {tenant.publicPhone && <p className="mt-1 text-sm text-muted">{tenant.publicPhone}</p>}
              {tenant.instagram && (
                <p className="text-sm text-muted">@{tenant.instagram.replace(/^@/, "")}</p>
              )}
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}

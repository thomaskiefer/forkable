import Link from 'next/link';
import { ArrowUpRight, GitPullRequestArrow, KanbanSquare, Plus, Target, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getChangeRequests, getClients, getLeadStages, getLeads } from '@/lib/queries';
import { cn } from '@/lib/utils';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export default async function CRMOverviewPage() {
  const { accessToken: token } = await requireAuthenticatedSession();

  const [leadsResult, clientsResult, stages, featureRequests] = await Promise.all([
    getLeads(token, 1, 50),
    getClients(token),
    getLeadStages(token),
    getChangeRequests(token),
  ]);

  const allLeads = leadsResult.leads as Array<Record<string, unknown>>;
  const pipelineValue = allLeads.reduce(
    (sum, lead) => sum + (typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0),
    0,
  );

  // Distribution by stage — used as a typographic sparkline
  const stageDistribution = stages.map((stage) => {
    const count = allLeads.filter(
      (lead) => (lead.current_stage_id as string) === stage.id,
    ).length;
    return { id: stage.id, name: stage.name, count };
  });
  const maxStageCount = Math.max(1, ...stageDistribution.map((s) => s.count));

  const secondaryStats = [
    { label: 'Leads', value: leadsResult.count, icon: Target, href: '/leads' },
    { label: 'Clients', value: clientsResult.count, icon: Users, href: '/clients' },
    { label: 'Stages', value: stages.length, icon: KanbanSquare, href: '/leads/pipeline' },
    {
      label: 'Feature requests',
      value: featureRequests.length,
      icon: GitPullRequestArrow,
      href: '/feature-requests',
    },
  ];

  const recentLeads = allLeads.slice(0, 5);

  return (
    <div className="stagger space-y-8">
      <PageHeader
        eyebrow="Overview"
        title="Your pipeline"
        description="Track deals, customer rollouts, and feature requests in one place."
        actions={
          <Link href="/leads/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              New lead
            </Button>
          </Link>
        }
      />

      {/* Hero KPI */}
      <section className="relative isolate overflow-hidden rounded-3xl border bg-card ring-warm">
        <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:p-12">
          <div className="flex flex-col">
            <p className="eyebrow">Pipeline value</p>
            <div className="mt-5 flex items-baseline gap-3">
              <p className="font-display nums-tabular text-balance text-7xl font-medium leading-[0.9] tracking-tight sm:text-8xl">
                {pipelineValue > 0 ? compactCurrency.format(pipelineValue) : '—'}
              </p>
              {pipelineValue > 0 ? (
                <p className="font-display text-base text-muted-foreground sm:text-lg">
                  {currency.format(pipelineValue)}
                </p>
              ) : null}
            </div>
            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              {allLeads.length > 0
                ? `${allLeads.length} active leads across ${stages.length} stages.`
                : 'Add a lead to start tracking deal value across your pipeline.'}
            </p>
            <div className="mt-auto flex flex-wrap gap-3 pt-8">
              <Link href="/leads/pipeline">
                <Button variant="outline" size="lg" className="gap-2">
                  Open pipeline <ArrowUpRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/leads">
                <Button variant="ghost" size="lg" className="gap-2">
                  View all leads
                </Button>
              </Link>
            </div>
          </div>

          {/* Stage bars — typographic sparkline */}
          <div className="relative">
            <p className="eyebrow mb-5">Distribution by stage</p>
            <div className="space-y-3">
              {stageDistribution.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stages yet.</p>
              ) : (
                stageDistribution.map((stage, i) => {
                  const widthPct = (stage.count / maxStageCount) * 100;
                  const tone = [
                    'bg-chart-2',
                    'bg-primary',
                    'bg-chart-3',
                    'bg-chart-4',
                    'bg-chart-5',
                  ][i % 5];
                  return (
                    <div key={stage.id} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate text-foreground">{stage.name}</span>
                        <span className="font-display nums-tabular text-sm font-medium tabular-nums text-muted-foreground">
                          {stage.count}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full transition-all', tone)}
                          style={{ width: `${Math.max(widthPct, stage.count > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Demoted secondary stats */}
      <section>
        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {secondaryStats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="group flex items-baseline justify-between gap-4 bg-card p-5 transition-colors hover:bg-accent"
            >
              <div className="space-y-1">
                <p className="eyebrow">{stat.label}</p>
                <p className="font-display nums-tabular text-3xl font-medium tabular-nums">
                  {stat.value}
                </p>
              </div>
              <stat.icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      {/* Recent leads */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-medium tracking-tight">Recent leads</h2>
          <Link
            href="/leads"
            className="text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            View all →
          </Link>
        </div>

        {recentLeads.length === 0 ? (
          <EmptyState
            icon={Target}
            eyebrow="No leads yet"
            title="Your first lead is one click away"
            description="Add a lead to start tracking deals through the pipeline."
            action={
              <Link href="/leads/add">
                <Button size="lg" className="gap-2">
                  <Plus className="h-4 w-4" /> Create your first lead
                </Button>
              </Link>
            }
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <div className="divide-y">
                {recentLeads.map((lead) => {
                  const stageName =
                    (lead.current_stage as Record<string, string> | undefined)?.name ??
                    (lead.status as string);
                  const dealValue =
                    typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0;
                  return (
                    <Link
                      key={lead.id as string}
                      href={`/leads/${lead.id}`}
                      className="group flex items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/40"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate font-medium">
                          {lead.contact_name as string}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {lead.company_name as string}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-right">
                        {dealValue > 0 ? (
                          <p className="font-display nums-tabular text-lg font-medium tabular-nums">
                            {currency.format(dealValue)}
                          </p>
                        ) : null}
                        <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          {stageName}
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

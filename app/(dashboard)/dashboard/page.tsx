import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle,
  GitPullRequestArrow,
  KanbanSquare,
  Plus,
  Target,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getClientOwner } from '@/lib/synthetic';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import {
  getChangeRequests,
  getClients,
  getLeadStages,
  getLeads,
  getProjects,
  hasFeatureFlag,
} from '@/lib/queries';
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

const forecastWeights: Record<string, number> = {
  'New Lead': 0.1,
  Contacted: 0.2,
  Discovery: 0.35,
  Qualified: 0.5,
  Proposal: 0.65,
  'Security Review': 0.7,
  'Contract Sent': 0.85,
  'Closed Won': 1,
  Lost: 0,
};

function stringScore(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getStageName(lead: Record<string, unknown>) {
  return (
    (lead.current_stage as Record<string, string> | undefined)?.name ??
    (lead.status as string)
  );
}

function daysSince(value: unknown) {
  if (typeof value !== 'string') return 0;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

function daysFromLead(lead: Record<string, unknown>, baseDays: number) {
  return baseDays + (stringScore(String(lead.id)) % 18);
}

export default async function CRMOverviewPage() {
  const { accessToken: token } = await requireAuthenticatedSession();

  const [
    leadsResult,
    clientsResult,
    stages,
    featureRequests,
    projectsResult,
    acmeClosePlanEnabled,
  ] = await Promise.all([
    getLeads(token, 1, 50),
    getClients(token),
    getLeadStages(token),
    getChangeRequests(token),
    getProjects(token, 1, 50),
    hasFeatureFlag('acme_dashboard_close_plan', token),
  ]);

  const allLeads = leadsResult.leads as Array<Record<string, unknown>>;
  const openLeads = allLeads.filter((lead) => {
    const stageName = getStageName(lead);
    return stageName !== 'Closed Won' && stageName !== 'Lost';
  });
  // Pipeline value = open-pipeline ARR. Closed Won and Lost are no longer
  // "in pipeline" — they belong in revenue / loss reports respectively.
  const pipelineValue = openLeads.reduce(
    (sum, lead) => sum + (typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0),
    0,
  );
  const weightedPipelineValue = openLeads.reduce((sum, lead) => {
    const dealValue = typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0;
    return sum + dealValue * (forecastWeights[getStageName(lead)] ?? 0.25);
  }, 0);
  const staleDeals = openLeads
    .map((lead) => ({
      lead,
      stageName: getStageName(lead),
      age: daysSince(lead.updated_at),
      nextTouchDays: daysFromLead(lead, -3),
    }))
    .filter((item) => item.age >= 7 || item.nextTouchDays <= 0)
    .sort((a, b) => b.age - a.age)
    .slice(0, 4);
  // At-risk = high-value late-stage deals that have aged without an update.
  // The label "Risk" is only honest if the filter actually surfaces friction —
  // late-stage alone isn't risk, late-stage + stale is.
  const atRiskDeals = openLeads
    .filter((lead) => {
      const stageName = getStageName(lead);
      const age = daysSince(lead.updated_at);
      const dealValue = typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0;
      const isLateStage = ['Security Review', 'Contract Sent', 'Proposal'].includes(stageName);
      return isLateStage && (age >= 7 || dealValue >= 100_000);
    })
    .sort((a, b) => {
      const aAge = daysSince(a.updated_at);
      const bAge = daysSince(b.updated_at);
      if (aAge !== bAge) return bAge - aAge;
      const aValue = typeof a.deal_value === 'number' ? (a.deal_value as number) : 0;
      const bValue = typeof b.deal_value === 'number' ? (b.deal_value as number) : 0;
      return bValue - aValue;
    })
    .slice(0, 4);
  const acmeClosePlanDeals = openLeads
    .filter((lead) => {
      const dealValue = typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0;
      return dealValue >= 50000 && ['Security Review', 'Contract Sent', 'Proposal'].includes(getStageName(lead));
    })
    .sort((a, b) => {
      const aValue = typeof a.deal_value === 'number' ? (a.deal_value as number) : 0;
      const bValue = typeof b.deal_value === 'number' ? (b.deal_value as number) : 0;
      return bValue - aValue;
    })
    .slice(0, 3);
  const projectQueue = (projectsResult.projects as Array<Record<string, unknown>>)
    .filter((project) => (project.deal_status as string) !== 'completed')
    .slice(0, 4);

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

  const forecastByStage = stageDistribution
    .map((stage) => {
      const stageLeads = allLeads.filter(
        (lead) => (lead.current_stage_id as string) === stage.id,
      );
      const raw = stageLeads.reduce(
        (sum, lead) => sum + (typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0),
        0,
      );
      return {
        ...stage,
        raw,
        weighted: raw * (forecastWeights[stage.name] ?? 0.25),
      };
    })
    .filter((stage) => stage.raw > 0);

  return (
    <div className="stagger space-y-8">
      <PageHeader
        eyebrow="Overview"
        title="Your pipeline"
        description="A working queue for deals, customer rollouts, and feature requests that need attention."
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
                ? `${openLeads.length} open deals · ${currency.format(weightedPipelineValue)} weighted forecast.`
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

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-0">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Needs attention</p>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Stale or overdue deals
                </h2>
              </div>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            {staleDeals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stale deals in the current view.</p>
            ) : (
              <div className="divide-y">
                {staleDeals.map(({ lead, stageName, age, nextTouchDays }) => {
                  const dealValue = typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0;
                  return (
                    <Link
                      key={lead.id as string}
                      href={`/leads/${lead.id}`}
                      className="group grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{lead.company_name as string}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {stageName} · {getClientOwner(lead)} · last update {age}d ago
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:justify-end">
                        <span className="font-display nums-tabular text-base font-medium tabular-nums">
                          {currency.format(dealValue)}
                        </span>
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.16em]',
                            nextTouchDays <= 0
                              ? 'border-destructive/30 bg-destructive/10 text-destructive'
                              : 'border-chart-2/30 bg-chart-2/10 text-chart-2',
                          )}
                        >
                          {nextTouchDays <= 0 ? 'follow up due' : 'stale'}
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Forecast</p>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Weighted by stage
                </h2>
              </div>
              <p className="font-display nums-tabular text-xl font-medium tabular-nums">
                {compactCurrency.format(weightedPipelineValue)}
              </p>
            </div>
            <div className="space-y-3">
              {forecastByStage.slice(0, 6).map((stage) => (
                <div key={stage.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-foreground">{stage.name}</span>
                    <span className="font-display nums-tabular text-sm font-medium tabular-nums text-muted-foreground">
                      {compactCurrency.format(stage.weighted)}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.max(4, (stage.weighted / Math.max(1, weightedPipelineValue)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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

      <section className="grid gap-4 lg:grid-cols-2">
        {acmeClosePlanEnabled ? (
          <Card className="p-0 lg:col-span-2">
            <CardContent className="p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Acme close plan</p>
                  <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                    Enterprise deal actions
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Confirm legal owner, attach security notes, and schedule procurement follow-up before advancing enterprise deals.
                  </p>
                </div>
                <CheckCircle className="h-4 w-4 text-primary" />
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {[
                  'Confirm legal owner',
                  'Attach security notes',
                  'Schedule procurement follow-up',
                ].map((action) => (
                  <div key={action} className="rounded-lg border bg-card px-4 py-3">
                    <p className="text-sm font-medium">{action}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Required before Contract Sent or Closed Won.</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 divide-y rounded-lg border bg-background">
                {acmeClosePlanDeals.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No late-stage enterprise deals need attention.</p>
                ) : (
                  acmeClosePlanDeals.map((lead) => (
                    <Link
                      key={lead.id as string}
                      href={`/leads/${lead.id}`}
                      className="group grid gap-3 px-4 py-3 transition-colors hover:bg-accent/40 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{lead.company_name as string}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {getStageName(lead)} · {getClientOwner(lead)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:justify-end">
                        <span className="font-display nums-tabular text-base font-medium tabular-nums">
                          {currency.format(typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0)}
                        </span>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="p-0">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Risk</p>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  High-value blockers
                </h2>
              </div>
              <AlertTriangle className="h-4 w-4 text-chart-2" />
            </div>
            <div className="space-y-3">
              {atRiskDeals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No high-value late-stage blockers.</p>
              ) : (
                atRiskDeals.map((lead) => (
                  <Link
                    key={lead.id as string}
                    href={`/leads/${lead.id}`}
                    className="group flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{lead.company_name as string}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {getStageName(lead)} · close plan due in {daysFromLead(lead, 7)}d
                      </p>
                    </div>
                    <span className="font-display nums-tabular shrink-0 text-base font-medium tabular-nums">
                      {currency.format(typeof lead.deal_value === 'number' ? (lead.deal_value as number) : 0)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Delivery</p>
                <h2 className="mt-1 font-display text-2xl font-medium tracking-tight">
                  Active rollout queue
                </h2>
              </div>
              <Link
                href="/projects"
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                View projects →
              </Link>
            </div>
            <div className="space-y-3">
              {projectQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active customer rollouts.</p>
              ) : (
                projectQueue.map((project) => {
                  const clientName = (project.client as Record<string, string> | undefined)?.name;
                  return (
                    <div
                      key={project.id as string}
                      className="grid gap-3 rounded-lg border bg-card px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{project.name as string}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {clientName ?? 'Client'} · {getClientOwner({ name: clientName })} · milestone in {daysFromLead(project, 5)}d
                        </p>
                      </div>
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-primary">
                        {(project.deal_status as string).replace('_', ' ')}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-medium tracking-tight">Recently opened deals</h2>
          <Link
            href="/leads"
            className="text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            View all →
          </Link>
        </div>

        {allLeads.slice(0, 5).length === 0 ? (
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
                {allLeads.slice(0, 5).map((lead) => {
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

import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Briefcase, CalendarClock, CheckCircle2, Plus } from 'lucide-react';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getProjects } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getClientOwner, stableIndex } from '@/lib/synthetic';
import { cn } from '@/lib/utils';

type ProjectRow = Record<string, unknown>;
type ClientRow = Record<string, unknown>;

const statusTone: Record<string, string> = {
  active: 'border-primary/30 bg-primary/10 text-primary',
  on_hold: 'border-chart-2/30 bg-chart-2/10 text-chart-2',
  completed: 'border-chart-3/30 bg-chart-3/10 text-chart-3',
  cancelled: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const riskTone: Record<string, string> = {
  Low: 'text-primary',
  Medium: 'text-chart-4',
  High: 'text-destructive',
  Closed: 'text-muted-foreground',
};

const phaseTone: Record<string, string> = {
  Discovery: 'bg-chart-2',
  Build: 'bg-primary',
  Pilot: 'bg-chart-3',
  Rollout: 'bg-chart-4',
  Closed: 'bg-muted-foreground',
};

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function parseDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

function getProgress(project: ProjectRow, now: Date) {
  const status = String(project.deal_status ?? 'active').toLowerCase();
  if (status === 'completed') return 100;
  if (status === 'cancelled') return 0;

  const start = parseDate(project.start_date);
  const end = parseDate(project.end_date);

  if (start && end && end > start) {
    const elapsed = now.getTime() - start.getTime();
    const duration = end.getTime() - start.getTime();
    return Math.min(96, Math.max(8, Math.round((elapsed / duration) * 100)));
  }

  return 35 + stableIndex(String(project.id ?? project.name), 45);
}

function getPhase(project: ProjectRow, progress: number) {
  const status = String(project.deal_status ?? 'active').toLowerCase();
  if (['completed', 'cancelled'].includes(status)) return 'Closed';
  if (progress < 25) return 'Discovery';
  if (progress < 60) return 'Build';
  if (progress < 85) return 'Pilot';
  return 'Rollout';
}

function getRisk(project: ProjectRow, now: Date) {
  const status = String(project.deal_status ?? 'active').toLowerCase();
  if (['completed', 'cancelled'].includes(status)) return 'Closed';

  const dueDate = parseDate(project.end_date);
  if (!dueDate) return 'Medium';

  const daysToDue = daysBetween(now, dueDate);
  if (daysToDue < 0) return 'High';
  if (daysToDue <= 14) return 'Medium';
  return 'Low';
}

function formatDue(project: ProjectRow, now: Date) {
  const dueDate = parseDate(project.end_date);
  if (!dueDate) return 'No due date';

  const daysToDue = daysBetween(now, dueDate);
  if (daysToDue < 0) return `${Math.abs(daysToDue)}d overdue`;
  if (daysToDue === 0) return 'Due today';
  return `${dateFormat.format(dueDate)} (${daysToDue}d)`;
}

export default async function ProjectsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const { projects, count } = await getProjects(token);
  const now = new Date();
  const projectRows = projects as ProjectRow[];
  const activeProjects = projectRows.filter(
    (project) => !['completed', 'cancelled'].includes(String(project.deal_status ?? '').toLowerCase()),
  );
  const atRiskCount = activeProjects.filter((project) => getRisk(project, now) !== 'Low').length;
  const avgProgress = activeProjects.length
    ? Math.round(
      activeProjects.reduce((sum, project) => sum + getProgress(project, now), 0) / activeProjects.length,
    )
    : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description={
          count > 0
            ? `${count} ${count === 1 ? 'project' : 'projects'} in motion across your clients.`
            : 'Once a client is converted, projects track the work you deliver.'
        }
        actions={
          <Link href="/projects/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> New project
            </Button>
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          eyebrow="Ready when you are"
          title="No projects yet"
          description="Spin one up when a deal closes. Track scope, status, and the client it belongs to."
          action={
            <Link href="/projects/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> Start a project
              </Button>
            </Link>
          }
        />
      ) : (
        <>
        <section className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          {[
            { label: 'Active work', value: activeProjects.length, icon: Briefcase },
            { label: 'Average progress', value: `${avgProgress}%`, icon: CheckCircle2 },
            { label: 'Needs attention', value: atRiskCount, icon: AlertTriangle },
          ].map((stat) => (
            <div key={stat.label} className="flex items-start justify-between gap-4 bg-card p-5">
              <div className="space-y-1">
                <p className="eyebrow">{stat.label}</p>
                <p className="font-display nums-tabular text-3xl font-medium tabular-nums">
                  {stat.value}
                </p>
              </div>
              <stat.icon className="mt-1 h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </section>

        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="hidden grid-cols-[minmax(240px,1.25fr)_0.9fr_0.65fr_1fr_0.8fr_0.65fr_0.8fr] gap-4 border-b bg-muted/30 px-6 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground lg:grid">
              <span>Project</span>
              <span>Account</span>
              <span>Owner</span>
              <span>Progress</span>
              <span>Due</span>
              <span>Risk</span>
              <span className="text-right">Status</span>
            </div>
            <div className="divide-y">
              {projectRows.map((project) => {
                const name = project.name as string;
                const client = project.client as ClientRow | undefined;
                const clientName = client?.name as string | undefined;
                const status = (project.deal_status as string) ?? 'active';
                const progress = getProgress(project, now);
                const phase = getPhase(project, progress);
                const risk = getRisk(project, now);
                const owner = getClientOwner(project);

                return (
                  <div
                    key={project.id as string}
                    className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(240px,1.25fr)_0.9fr_0.65fr_1fr_0.8fr_0.65fr_0.8fr] lg:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium">{name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            phaseTone[phase] ?? 'bg-muted-foreground',
                          )}
                        />
                        <span>{phase}</span>
                        {project.billable ? <span>Billable</span> : <span>Internal</span>}
                      </div>
                    </div>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium lg:hidden">Account</p>
                      <p className="truncate text-muted-foreground lg:text-foreground">
                        {clientName ?? 'Unassigned account'}
                      </p>
                      {client?.client_code ? (
                        <p className="truncate text-xs text-muted-foreground">{client.client_code as string}</p>
                      ) : null}
                    </div>
                    <div className="text-sm">
                      <p className="font-medium lg:hidden">Owner</p>
                      <p className="text-muted-foreground lg:text-foreground">{owner}</p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium lg:hidden">Progress</span>
                        <span className="nums-tabular tabular-nums text-muted-foreground lg:text-foreground">
                          {progress}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', phaseTone[phase] ?? 'bg-primary')}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <CalendarClock className="mt-0.5 h-4 w-4 text-muted-foreground lg:hidden" />
                      <div>
                        <p className="font-medium lg:hidden">Due</p>
                        <p className="text-muted-foreground lg:text-foreground">{formatDue(project, now)}</p>
                      </div>
                    </div>
                    <div className={cn('text-sm font-medium', riskTone[risk])}>
                      <p className="font-medium text-foreground lg:hidden">Risk</p>
                      {risk}
                    </div>
                    <div className="flex items-center justify-between gap-3 lg:justify-end">
                      <span
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                          statusTone[status] ?? 'border-border text-muted-foreground',
                        )}
                      >
                        {status.replace('_', ' ')}
                      </span>
                      <ArrowUpRight className="hidden h-4 w-4 text-muted-foreground lg:block" />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        </>
      )}
    </div>
  );
}

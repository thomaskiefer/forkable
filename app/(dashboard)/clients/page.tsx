import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, GitPullRequestArrow, Plus, Users } from 'lucide-react';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getChangeRequests, getClients, getProjects } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

type ClientRow = Record<string, unknown>;
type ProjectRow = Record<string, unknown>;
type RequestRow = Record<string, unknown>;

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const owners = [
  'Maya Patel',
  'Elliot Park',
  'Nora Singh',
  'Theo Martin',
  'Amara Okafor',
  'Julian Reed',
];

const healthTone: Record<string, string> = {
  Strong: 'border-primary/30 bg-primary/10 text-primary',
  Watch: 'border-chart-4/40 bg-chart-4/10 text-chart-4',
  Risk: 'border-destructive/30 bg-destructive/10 text-destructive',
  Dormant: 'border-border bg-muted/40 text-muted-foreground',
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

function stableIndex(seed: string, modulo: number) {
  const total = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total % modulo;
}

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

function parseDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTouch(date: Date | null, now: Date) {
  if (!date) return 'No touch logged';
  const days = Math.max(0, daysBetween(date, now));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function getRenewalDate(client: ClientRow, now: Date) {
  const seed = `${client.client_code ?? client.id ?? client.name}`;
  const daysOut = 35 + stableIndex(seed, 260);
  const renewal = new Date(now);
  renewal.setDate(renewal.getDate() + daysOut);
  return renewal;
}

function getContractValue(client: ClientRow, projects: ProjectRow[]) {
  const seed = `${client.client_code ?? client.name ?? client.id}`;
  const base = 90_000 + stableIndex(seed, 12) * 35_000;
  const activeBillable = projects.filter(
    (project) => project.deal_status !== 'cancelled' && project.billable !== false,
  ).length;
  return base + activeBillable * 80_000;
}

function getHealth(
  client: ClientRow,
  projects: ProjectRow[],
  requests: RequestRow[],
  now: Date,
) {
  if (!client.is_active) return 'Dormant';

  const hasOverdueProject = projects.some((project) => {
    const dueDate = parseDate(project.end_date);
    return dueDate && daysBetween(now, dueDate) < 0 && project.deal_status !== 'completed';
  });
  if (hasOverdueProject) return 'Risk';

  const hasOpenRequest = requests.some((request) =>
    !['completed', 'cancelled', 'merged', 'shipped'].includes(String(request.status ?? '').toLowerCase()),
  );
  if (hasOpenRequest || projects.length === 0) return 'Watch';

  return 'Strong';
}

export default async function ClientsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const [{ clients, count }, projectsResult, changeRequests] = await Promise.all([
    getClients(token),
    getProjects(token),
    getChangeRequests(token),
  ]);

  const projects = projectsResult.projects as ProjectRow[];
  const requests = changeRequests as RequestRow[];
  const now = new Date();

  const openProjectCount = projects.filter(
    (project) => !['completed', 'cancelled'].includes(String(project.deal_status ?? '').toLowerCase()),
  ).length;
  const openRequestCount = requests.filter(
    (request) => !['completed', 'cancelled', 'merged', 'shipped'].includes(String(request.status ?? '').toLowerCase()),
  ).length;
  const contractValue = (clients as ClientRow[]).reduce((sum, client) => {
    const clientProjects = projects.filter((project) => project.client_id === client.id);
    return sum + getContractValue(client, clientProjects);
  }, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Customers"
        title="Clients"
        description={
          count > 0
            ? `${count} ${count === 1 ? 'client' : 'clients'} with delivery, renewal, and request context.`
            : 'Convert qualified leads into clients to start projects.'
        }
        actions={
          <Link href="/clients/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> New client
            </Button>
          </Link>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          eyebrow="A clean slate"
          title="No clients yet"
          description="Convert a lead from the pipeline, or add a client directly when one comes from another channel."
          action={
            <Link href="/clients/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> Add a client
              </Button>
            </Link>
          }
        />
      ) : (
        <>
        <section className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          {[
            { label: 'Book of business', value: currency.format(contractValue), icon: Users },
            { label: 'Open projects', value: openProjectCount, icon: BriefcaseBusiness },
            { label: 'Open requests', value: openRequestCount, icon: GitPullRequestArrow },
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
            <div className="hidden grid-cols-[minmax(220px,1.2fr)_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr_0.6fr] gap-4 border-b bg-muted/30 px-6 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground lg:grid">
              <span>Account</span>
              <span>Owner</span>
              <span>Contract</span>
              <span>Health</span>
              <span>Renewal</span>
              <span>Workload</span>
              <span className="text-right">Touch</span>
            </div>
            <div className="divide-y">
              {(clients as ClientRow[]).map((client) => {
                const name = client.name as string;
                const isActive = client.is_active as boolean;
                const clientProjects = projects.filter((project) => project.client_id === client.id);
                const clientRequests = requests.filter((request) => {
                  const requestAccountId = request.company_account_id;
                  if (requestAccountId && requestAccountId === client.company_account_id) {
                    return true;
                  }

                  return (
                    String(request.customer_name ?? '').trim().toLowerCase() ===
                    name.trim().toLowerCase()
                  );
                });
                const activeProjects = clientProjects.filter(
                  (project) => !['completed', 'cancelled'].includes(String(project.deal_status ?? '').toLowerCase()),
                ).length;
                const health = getHealth(client, clientProjects, clientRequests, now);
                const lastTouch = [
                  parseDate(client.updated_at),
                  ...clientProjects.map((project) => parseDate(project.updated_at)),
                  ...clientRequests.map((request) => parseDate(request.updated_at ?? request.created_at)),
                ]
                  .filter((date): date is Date => Boolean(date))
                  .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
                const owner = owners[stableIndex(String(client.client_code ?? name), owners.length)];
                const renewalDate = getRenewalDate(client, now);

                return (
                  <div
                    key={client.id as string}
                    className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(220px,1.2fr)_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr_0.6fr] lg:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card font-display text-sm font-medium">
                        {initials(name)}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate font-medium">{name}</p>
                      </div>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium lg:hidden">Owner</p>
                      <p className="text-muted-foreground lg:text-foreground">{owner}</p>
                    </div>
                    <div className="font-display nums-tabular text-lg font-medium tabular-nums">
                      {currency.format(getContractValue(client, clientProjects))}
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                        healthTone[health],
                      )}
                    >
                      {health}
                    </span>
                    <div className="text-sm">
                      <p className="font-medium lg:hidden">Renewal</p>
                      <p className="text-muted-foreground lg:text-foreground">{dateFormat.format(renewalDate)}</p>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">
                        {activeProjects} open {activeProjects === 1 ? 'project' : 'projects'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {clientRequests.length} {clientRequests.length === 1 ? 'request' : 'requests'}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm lg:justify-end lg:text-right">
                      <div>
                        <p className="font-medium lg:hidden">Last touch</p>
                        <p className="text-muted-foreground lg:text-foreground">
                          {formatRelativeTouch(lastTouch, now)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
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

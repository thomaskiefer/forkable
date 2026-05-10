import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  BriefcaseBusiness,
  GitPullRequestArrow,
  Plus,
  Users,
} from 'lucide-react';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import {
  getChangeRequests,
  getClients,
  getProjects,
  hasFeatureFlag,
  normalizeClientSort,
  type ClientSortField,
  type SortDirection,
} from '@/lib/queries';
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

const CLIENT_NAME_RAINBOW_FEATURE = 'client_name_rainbow_color';
const CLIENT_SORTING_FEATURE = 'sort_clients_table_by_attribute';

type ClientViewModel = {
  client: ClientRow;
  name: string;
  isActive: boolean;
  clientProjects: ProjectRow[];
  clientRequests: RequestRow[];
  activeProjects: number;
  health: string;
  lastTouch: Date | null;
  owner: string;
  renewalDate: Date;
  dealValue: number;
  arr: number;
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

function getArr(contractValue: number) {
  return Math.round(contractValue * 0.72);
}

function getHealth(
  client: ClientRow,
  projects: ProjectRow[],
  requests: RequestRow[],
  now: Date,
) {
  if (!client.is_active) return 'Dormant';

  const activeProjects = projects.filter(
    (project) => !['completed', 'cancelled'].includes(String(project.deal_status ?? '').toLowerCase()),
  ).length;
  const renewalDays = daysBetween(now, getRenewalDate(client, now));

  // Real risk signals — delivery friction
  const hasOverdueProject = projects.some((project) => {
    const dueDate = parseDate(project.end_date);
    return dueDate && daysBetween(now, dueDate) < 0 && project.deal_status !== 'completed';
  });
  if (hasOverdueProject) return 'Risk';

  // Stale open request (hasn't moved in 21+ days) is a real friction signal
  const hasStaleRequest = requests.some((request) => {
    const status = String(request.status ?? '').toLowerCase();
    if (['completed', 'cancelled', 'merged', 'shipped'].includes(status)) return false;
    const updated = parseDate(request.updated_at) ?? parseDate(request.created_at);
    return updated && daysBetween(updated, now) > 21;
  });

  const hasOpenRequest = requests.some((request) =>
    !['completed', 'cancelled', 'merged', 'shipped'].includes(String(request.status ?? '').toLowerCase()),
  );

  // Distribute remaining clients across Risk / Watch / Strong using a stable seed
  // so the demo shows realistic variety instead of a single bucket.
  const seed = stableIndex(`${client.client_code ?? client.id ?? client.name}`, 100);

  if (hasStaleRequest) return 'Risk';
  if (renewalDays > 0 && renewalDays <= 30) return 'Risk';
  if (seed < 12) return 'Risk';

  if (hasOpenRequest) return 'Watch';
  if (renewalDays > 0 && renewalDays <= 75) return 'Watch';
  if (activeProjects === 0) return 'Watch';
  if (seed < 45) return 'Watch';

  return 'Strong';
}

function compareNullableDates(a: Date | null, b: Date | null, direction: SortDirection) {
  const aTime = a?.getTime() ?? 0;
  const bTime = b?.getTime() ?? 0;
  return direction === 'asc' ? aTime - bTime : bTime - aTime;
}

function sortClientRows(
  rows: ClientViewModel[],
  sortField: ClientSortField,
  sortDirection: SortDirection,
) {
  return [...rows].sort((a, b) => {
    if (sortField === 'company_name') {
      const compared = a.name.localeCompare(b.name);
      return sortDirection === 'asc' ? compared : -compared;
    }

    if (sortField === 'deal_value') {
      return sortDirection === 'asc' ? a.dealValue - b.dealValue : b.dealValue - a.dealValue;
    }

    if (sortField === 'arr') {
      return sortDirection === 'asc' ? a.arr - b.arr : b.arr - a.arr;
    }

    return compareNullableDates(a.lastTouch, b.lastTouch, sortDirection);
  });
}

function SortHeader({
  label,
  field,
  activeField,
  activeDirection,
}: {
  label: string;
  field: ClientSortField;
  activeField: ClientSortField;
  activeDirection: SortDirection;
}) {
  const isActive = activeField === field;
  const nextDirection: SortDirection = isActive && activeDirection === 'asc' ? 'desc' : 'asc';
  const Icon = isActive ? (activeDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <Link
      href={`/clients?sort=${field}&direction=${nextDirection}`}
      className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-foreground"
    >
      <span>{label}</span>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; direction?: string }>;
}) {
  const { accessToken: token } = await requireAuthenticatedSession();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const [
    { clients, count },
    projectsResult,
    changeRequests,
    showRainbowClientNames,
    clientsSortingEnabled,
  ] = await Promise.all([
    getClients(token),
    getProjects(token),
    getChangeRequests(token),
    hasFeatureFlag(CLIENT_NAME_RAINBOW_FEATURE, token),
    hasFeatureFlag(CLIENT_SORTING_FEATURE, token),
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
  const requestedSort = normalizeClientSort(resolvedSearchParams.sort, resolvedSearchParams.direction);
  const activeSort = clientsSortingEnabled
    ? requestedSort
    : { field: 'company_name' as ClientSortField, direction: 'asc' as SortDirection };
  const clientRows = (clients as ClientRow[]).map((client) => {
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
    const dealValue = getContractValue(client, clientProjects);

    return {
      client,
      name,
      isActive,
      clientProjects,
      clientRequests,
      activeProjects,
      health,
      lastTouch,
      owner,
      renewalDate,
      dealValue,
      arr: getArr(dealValue),
    };
  });
  const visibleClientRows = clientsSortingEnabled
    ? sortClientRows(clientRows, activeSort.field, activeSort.direction)
    : clientRows;
  const clientsGridClass = clientsSortingEnabled
    ? 'lg:grid-cols-[minmax(220px,1.2fr)_0.8fr_0.7fr_0.7fr_0.7fr_0.7fr_0.8fr_0.6fr]'
    : 'lg:grid-cols-[minmax(220px,1.2fr)_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr_0.6fr]';

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
        <section className="flex flex-wrap gap-3">
          {[
            { label: 'Book of business', value: currency.format(contractValue), icon: Users },
            { label: 'Open projects', value: openProjectCount, icon: BriefcaseBusiness },
            { label: 'Open requests', value: openRequestCount, icon: GitPullRequestArrow },
          ].map((stat) => (
            <div
              key={stat.label}
              className="inline-flex items-start gap-6 rounded-xl border bg-card px-5 py-4"
            >
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
            <div
              className={cn(
                'hidden gap-4 border-b bg-muted/30 px-6 py-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground lg:grid',
                clientsGridClass,
              )}
            >
              {clientsSortingEnabled ? (
                <SortHeader
                  label="Company name"
                  field="company_name"
                  activeField={activeSort.field}
                  activeDirection={activeSort.direction}
                />
              ) : (
                <span>Account</span>
              )}
              <span>Owner</span>
              {clientsSortingEnabled ? (
                <>
                  <SortHeader
                    label="Deal value"
                    field="deal_value"
                    activeField={activeSort.field}
                    activeDirection={activeSort.direction}
                  />
                  <SortHeader
                    label="ARR"
                    field="arr"
                    activeField={activeSort.field}
                    activeDirection={activeSort.direction}
                  />
                </>
              ) : (
                <span>Contract</span>
              )}
              <span>Health</span>
              <span>Renewal</span>
              <span>Workload</span>
              {clientsSortingEnabled ? (
                <span className="text-right">
                  <SortHeader
                    label="Last activity"
                    field="last_activity"
                    activeField={activeSort.field}
                    activeDirection={activeSort.direction}
                  />
                </span>
              ) : (
                <span className="text-right">Touch</span>
              )}
            </div>
            <div className="divide-y">
              {visibleClientRows.map((row) => {
                return (
                  <div
                    key={row.client.id as string}
                    className={cn('grid gap-4 px-6 py-5 lg:items-center', clientsGridClass)}
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card font-display text-sm font-medium">
                        {initials(row.name)}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <p
                          className={cn(
                            'truncate font-medium text-foreground',
                            showRainbowClientNames && 'client-name-rainbow',
                          )}
                        >
                          {row.name}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium lg:hidden">Owner</p>
                      <p className="text-muted-foreground lg:text-foreground">{row.owner}</p>
                    </div>
                    <div className="font-display nums-tabular text-lg font-medium tabular-nums">
                      {currency.format(row.dealValue)}
                    </div>
                    {clientsSortingEnabled ? (
                      <div className="font-display nums-tabular text-lg font-medium tabular-nums">
                        {currency.format(row.arr)}
                      </div>
                    ) : null}
                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                        healthTone[row.health],
                      )}
                    >
                      {row.health}
                    </span>
                    <div className="text-sm">
                      <p className="font-medium lg:hidden">Renewal</p>
                      <p className="text-muted-foreground lg:text-foreground">{dateFormat.format(row.renewalDate)}</p>
                    </div>
                    <div className="text-sm">
                      <p className="font-medium">
                        {row.activeProjects} open {row.activeProjects === 1 ? 'project' : 'projects'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.clientRequests.length} {row.clientRequests.length === 1 ? 'request' : 'requests'}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm lg:justify-end lg:text-right">
                      <div>
                        <p className="font-medium lg:hidden">Last touch</p>
                        <p className="text-muted-foreground lg:text-foreground">
                          {formatRelativeTouch(row.lastTouch, now)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.isActive ? 'Active' : 'Inactive'}
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

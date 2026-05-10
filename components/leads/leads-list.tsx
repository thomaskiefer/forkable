'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Plus, Search, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const statusTone: Record<string, string> = {
  new: 'bg-muted text-muted-foreground border-border',
  contacted: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  qualified: 'bg-primary/12 text-primary border-primary/30',
  unqualified: 'bg-destructive/10 text-destructive border-destructive/30',
};

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const relativeDate = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

type Urgency = 'low' | 'medium' | 'high';
type SortKey = 'newest' | 'value-desc' | 'urgency' | 'close-date';

function isDefined<T>(value: T | undefined | null): value is T {
  return value != null;
}

interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email?: string;
  status: string;
  deal_value?: number;
  created_at: string;
  source?: { name: string };
  current_stage?: { name: string };
}

function daysSince(date: string) {
  const value = new Date(date).getTime();
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.floor((Date.now() - value) / 86_400_000));
}

function addDays(date: string, days: number) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  value.setDate(value.getDate() + days);
  return value;
}

function formatRelativeDays(days: number) {
  if (days === 0) return 'today';
  return relativeDate.format(-days, 'day');
}

function getUrgency(lead: Lead): Urgency {
  const age = daysSince(lead.created_at);
  const dealValue = lead.deal_value ?? 0;

  if (lead.status === 'qualified' && (dealValue >= 50_000 || age >= 21)) return 'high';
  if (lead.status === 'contacted' && age >= 14) return 'high';
  if (lead.status === 'new' && age >= 7) return 'high';
  if (dealValue >= 25_000 || age >= 10 || lead.status === 'qualified') return 'medium';
  return 'low';
}

function getProbability(lead: Lead) {
  if (lead.status === 'unqualified') return 5;
  if (lead.status === 'qualified') return 65;
  if (lead.status === 'contacted') return 35;
  return 15;
}

function getExpectedCloseDate(lead: Lead) {
  const urgency = getUrgency(lead);
  const daysToClose = urgency === 'high' ? 14 : urgency === 'medium' ? 28 : 45;
  return addDays(lead.created_at, daysToClose);
}

function getLastActivity(lead: Lead) {
  const age = daysSince(lead.created_at);
  if (lead.status === 'new') return `Created ${formatRelativeDays(age)}`;
  if (lead.status === 'contacted') return `Contacted ${formatRelativeDays(Math.max(1, Math.floor(age / 2)))}`;
  if (lead.status === 'qualified') return `Qualified ${formatRelativeDays(Math.max(1, Math.floor(age / 3)))}`;
  return `Closed out ${formatRelativeDays(Math.max(1, Math.floor(age / 2)))}`;
}

function getNextStep(lead: Lead) {
  if (lead.status === 'new') return 'Make first contact';
  if (lead.status === 'contacted') return 'Confirm pain and timeline';
  if (lead.status === 'qualified') return 'Schedule proposal review';
  return 'Archive or reopen if context changes';
}

const urgencyTone: Record<Urgency, string> = {
  low: 'border-border bg-muted text-muted-foreground',
  medium: 'border-chart-4/30 bg-chart-4/15 text-chart-4',
  high: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function LeadsList({
  initialLeads,
  initialCount,
}: {
  initialLeads: Lead[];
  initialCount: number;
}) {
  const [leads] = useState(initialLeads);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  const statusOptions = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.status))).sort(),
    [leads],
  );
  const stageOptions = useMemo(
    () =>
      Array.from(new Set(leads.map((lead) => lead.current_stage?.name).filter(isDefined))).sort(),
    [leads],
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.source?.name).filter(isDefined))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const urgencyRank: Record<Urgency, number> = { high: 3, medium: 2, low: 1 };

    return leads
      .filter((lead) => {
        const matchesSearch =
          !q ||
          lead.company_name.toLowerCase().includes(q) ||
          lead.contact_name.toLowerCase().includes(q) ||
          lead.contact_email?.toLowerCase().includes(q) ||
          lead.source?.name.toLowerCase().includes(q) ||
          lead.current_stage?.name.toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
        const matchesStage = stageFilter === 'all' || lead.current_stage?.name === stageFilter;
        const matchesSource = sourceFilter === 'all' || lead.source?.name === sourceFilter;
        const matchesUrgency =
          urgencyFilter === 'all' || getUrgency(lead) === urgencyFilter;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesStage &&
          matchesSource &&
          matchesUrgency
        );
      })
      .sort((a, b) => {
        if (sortKey === 'value-desc') {
          return (b.deal_value ?? 0) - (a.deal_value ?? 0);
        }
        if (sortKey === 'urgency') {
          return urgencyRank[getUrgency(b)] - urgencyRank[getUrgency(a)];
        }
        if (sortKey === 'close-date') {
          return (
            (getExpectedCloseDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (getExpectedCloseDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [leads, query, sortKey, sourceFilter, stageFilter, statusFilter, urgencyFilter]);

  const openPipelineValue = useMemo(
    () =>
      leads
        .filter((lead) => {
          const stageName = lead.current_stage?.name?.toLowerCase();
          return stageName !== 'closed won' && stageName !== 'lost';
        })
        .reduce((sum, l) => sum + (l.deal_value ?? 0), 0),
    [leads],
  );
  const weightedValue = useMemo(
    () =>
      filtered.reduce(
        (sum, lead) => sum + ((lead.deal_value ?? 0) * getProbability(lead)) / 100,
        0,
      ),
    [filtered],
  );

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        description={
          initialCount > 0
            ? `${initialCount} ${initialCount === 1 ? 'lead' : 'leads'} · ${currency.format(openPipelineValue)} open pipeline`
            : 'Your pipeline starts here.'
        }
        actions={
          <Link href="/leads/add">
            <Button size="lg" className="gap-2">
              <Plus className="h-4 w-4" /> New lead
            </Button>
          </Link>
        }
      />

      {leads.length > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(140px,180px))]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search leads, contacts, emails…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {stageOptions.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {stage}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All urgency</SelectItem>
                <SelectItem value="high">High urgency</SelectItem>
                <SelectItem value="medium">Medium urgency</SelectItem>
                <SelectItem value="low">Low urgency</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="value-desc">Highest value</SelectItem>
                <SelectItem value="urgency">Highest urgency</SelectItem>
                <SelectItem value="close-date">Expected close</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Showing
              </p>
              <p className="mt-1 font-display text-xl font-medium">
                {filtered.length} of {leads.length}
              </p>
            </div>
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Filtered value
              </p>
              <p className="mt-1 font-display text-xl font-medium">
                {currency.format(filtered.reduce((sum, lead) => sum + (lead.deal_value ?? 0), 0))}
              </p>
            </div>
            <div className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Weighted value
              </p>
              <p className="mt-1 font-display text-xl font-medium">
                {currency.format(weightedValue)}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {leads.length === 0 ? (
        <EmptyState
          icon={Target}
          eyebrow="A clean slate"
          title="Add your first lead"
          description="Track companies, contacts, deal value, and stage progress."
          action={
            <Link href="/leads/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> Create a lead
              </Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No leads match the current filters.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((lead) => {
                const urgency = getUrgency(lead);
                const probability = getProbability(lead);
                const expectedClose = getExpectedCloseDate(lead);

                return (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="group grid gap-4 px-6 py-5 transition-colors hover:bg-accent/40 lg:grid-cols-[minmax(220px,1.4fr)_minmax(260px,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-baseline gap-3">
                        <p className="truncate font-medium">{lead.contact_name}</p>
                        <span className="truncate text-sm text-muted-foreground">
                          · {lead.company_name}
                        </span>
                      </div>
                      {lead.contact_email ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {lead.contact_email}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {lead.source?.name ? (
                          <span className="rounded-full border bg-background px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                            {lead.source.name}
                          </span>
                        ) : null}
                        {lead.current_stage ? (
                          <span className="rounded-full border bg-card px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                            {lead.current_stage.name}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.16em]',
                            statusTone[lead.status] ?? statusTone.new,
                          )}
                        >
                          {lead.status}
                        </span>
                        <span
                          className={cn(
                            'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.16em]',
                            urgencyTone[urgency],
                          )}
                        >
                          {urgency}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                      <p className="truncate">
                        <span className="text-foreground">Next:</span> {getNextStep(lead)}
                      </p>
                      <p className="truncate">
                        <span className="text-foreground">Last:</span> {getLastActivity(lead)}
                      </p>
                      <p className="truncate">
                        <span className="text-foreground">Close:</span>{' '}
                        {expectedClose
                          ? expectedClose.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'TBD'}
                      </p>
                      <p className="truncate">
                        <span className="text-foreground">Prob:</span> {probability}%
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center justify-between gap-5 lg:justify-end">
                      {typeof lead.deal_value === 'number' && lead.deal_value > 0 ? (
                        <div className="text-right">
                          <span className="font-display nums-tabular text-lg font-medium tabular-nums">
                            {currency.format(lead.deal_value)}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {currency.format(((lead.deal_value ?? 0) * probability) / 100)} weighted
                          </p>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}

                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

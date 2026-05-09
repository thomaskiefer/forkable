'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DraggableStateSnapshot,
  type DropResult,
  type DroppableProvided,
} from '@hello-pangea/dnd';
import { List, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import type { LeadStage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PipelineLead {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email?: string;
  status: string;
  deal_value?: number;
  created_at: string;
  current_stage_id: string;
  source?: { name: string };
  current_stage?: { name: string; order_index?: number };
}

interface PipelineStage extends LeadStage {
  leads: PipelineLead[];
}

const stageTones = [
  { dot: 'bg-chart-2', text: 'text-chart-2' },
  { dot: 'bg-primary', text: 'text-primary' },
  { dot: 'bg-chart-3', text: 'text-chart-3' },
  { dot: 'bg-chart-4', text: 'text-chart-4' },
  { dot: 'bg-chart-5', text: 'text-chart-5' },
];

const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const relativeDate = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
type Urgency = 'low' | 'medium' | 'high';
type SortKey = 'stage-default' | 'value-desc' | 'urgency' | 'age-desc' | 'close-date';

function isDefined<T>(value: T | undefined | null): value is T {
  return value != null;
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

function getStageProbability(stage: LeadStage | undefined, stageCount: number, status: string) {
  if (status === 'unqualified') return 5;

  const stagePosition =
    typeof stage?.order_index === 'number' && stageCount > 1
      ? stage.order_index / Math.max(1, stageCount - 1)
      : 0;
  const stageProbability = Math.round(15 + stagePosition * 70);
  const boundedStageProbability = Math.max(10, Math.min(stageProbability, 85));

  if (status === 'qualified') return Math.max(boundedStageProbability, 60);
  if (status === 'contacted') return Math.max(boundedStageProbability, 30);
  return boundedStageProbability;
}

function getUrgency(lead: PipelineLead, stage: LeadStage | undefined, stageCount: number): Urgency {
  const age = daysSince(lead.created_at);
  const dealValue = lead.deal_value ?? 0;
  const probability = getStageProbability(stage, stageCount, lead.status);

  if (lead.status === 'qualified' && (dealValue >= 50_000 || age >= 21)) return 'high';
  if (probability >= 65 && age >= 14) return 'high';
  if (lead.status === 'contacted' && age >= 14) return 'high';
  if (lead.status === 'new' && age >= 7) return 'high';
  if (dealValue >= 25_000 || age >= 10 || probability >= 55) return 'medium';
  return 'low';
}

function getExpectedCloseDate(lead: PipelineLead, urgency: Urgency, probability: number) {
  const daysToClose = urgency === 'high' ? 14 : probability >= 60 ? 21 : urgency === 'medium' ? 30 : 45;
  return addDays(lead.created_at, daysToClose);
}

function getRiskCue(lead: PipelineLead, urgency: Urgency, age: number, probability: number) {
  if (lead.status === 'unqualified') return 'Disqualified';
  if (urgency === 'high' && age >= 21) return 'Stale high-value motion';
  if (urgency === 'high') return 'Needs action';
  if (probability >= 60 && age >= 14) return 'Late-stage aging';
  if (age <= 3) return 'Fresh lead';
  return 'On track';
}

function getNextStep(status: string) {
  if (status === 'new') return 'First contact';
  if (status === 'contacted') return 'Qualify need';
  if (status === 'qualified') return 'Proposal review';
  return 'Review fit';
}

const urgencyTone: Record<Urgency, string> = {
  low: 'border-border bg-muted text-muted-foreground',
  medium: 'border-chart-4/30 bg-chart-4/15 text-chart-4',
  high: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function LeadPipeline({
  initialStages,
  initialLeads,
}: {
  initialStages: LeadStage[];
  initialLeads: PipelineLead[];
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('stage-default');
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stagesWithLeads: PipelineStage[] = useMemo(
    () =>
      initialStages.map((stage) => ({
        ...stage,
        leads: initialLeads.filter((l) => l.current_stage_id === stage.id),
      })),
    [initialStages, initialLeads],
  );

  const [stages, setStages] = useState(stagesWithLeads);

  useEffect(() => {
    setStages(stagesWithLeads);
  }, [stagesWithLeads]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const sourceStageId = result.source.droppableId;
    const destStageId = result.destination.droppableId;
    if (sourceStageId === destStageId) return;

    const leadId = result.draggableId;

    const newStages = stages.map((s) => ({ ...s, leads: [...s.leads] }));
    const sourceStage = newStages.find((s) => s.id === sourceStageId);
    const destStage = newStages.find((s) => s.id === destStageId);

    if (sourceStage && destStage) {
      const leadIndex = sourceStage.leads.findIndex((candidate) => candidate.id === leadId);
      if (leadIndex === -1) return;

      const [lead] = sourceStage.leads.splice(leadIndex, 1);
      destStage.leads.splice(result.destination.index, 0, {
        ...lead,
        current_stage_id: destStageId,
      });
      setStages(newStages);
    }

    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageId: destStageId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update stage');
      }
      toast.success('Lead stage updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update stage');
      router.refresh();
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    router.refresh();
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(() => setRefreshing(false), 500);
  };

  const statusOptions = useMemo(
    () => Array.from(new Set(initialLeads.map((lead) => lead.status))).sort(),
    [initialLeads],
  );
  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(initialLeads.map((lead) => lead.source?.name).filter(isDefined))).sort(),
    [initialLeads],
  );

  const filterLeads = (leads: PipelineLead[], stage: LeadStage) => {
    const term = searchTerm.toLowerCase();
    const urgencyRank: Record<Urgency, number> = { high: 3, medium: 2, low: 1 };

    return leads
      .filter((lead) => {
        const urgency = getUrgency(lead, stage, stages.length);
        const matchesSearch =
          !term ||
          lead.company_name.toLowerCase().includes(term) ||
          lead.contact_name.toLowerCase().includes(term) ||
          lead.contact_email?.toLowerCase().includes(term) ||
          lead.source?.name.toLowerCase().includes(term);
        const matchesStatus = statusFilter === 'all' || lead.status === statusFilter;
        const matchesSource = sourceFilter === 'all' || lead.source?.name === sourceFilter;
        const matchesUrgency = urgencyFilter === 'all' || urgency === urgencyFilter;

        return matchesSearch && matchesStatus && matchesSource && matchesUrgency;
      })
      .sort((a, b) => {
        if (sortKey === 'value-desc') return (b.deal_value ?? 0) - (a.deal_value ?? 0);
        if (sortKey === 'urgency') {
          return (
            urgencyRank[getUrgency(b, stage, stages.length)] -
            urgencyRank[getUrgency(a, stage, stages.length)]
          );
        }
        if (sortKey === 'age-desc') return daysSince(b.created_at) - daysSince(a.created_at);
        if (sortKey === 'close-date') {
          const aUrgency = getUrgency(a, stage, stages.length);
          const bUrgency = getUrgency(b, stage, stages.length);
          return (
            (getExpectedCloseDate(
              a,
              aUrgency,
              getStageProbability(stage, stages.length, a.status),
            )?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (getExpectedCloseDate(
              b,
              bUrgency,
              getStageProbability(stage, stages.length, b.status),
            )?.getTime() ?? Number.MAX_SAFE_INTEGER)
          );
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  };

  const totalValue = useMemo(
    () =>
      stages.reduce(
        (sum, s) => sum + s.leads.reduce((acc, l) => acc + (l.deal_value ?? 0), 0),
        0,
      ),
    [stages],
  );
  const totalLeads = useMemo(
    () => stages.reduce((sum, s) => sum + s.leads.length, 0),
    [stages],
  );
  const weightedValue = useMemo(
    () =>
      stages.reduce(
        (sum, stage) =>
          sum +
          stage.leads.reduce(
            (stageSum, lead) =>
              stageSum +
              ((lead.deal_value ?? 0) *
                getStageProbability(stage, stages.length, lead.status)) /
                100,
            0,
          ),
        0,
      ),
    [stages],
  );
  const visibleLeads = useMemo(
    () => stages.reduce((sum, stage) => sum + filterLeads(stage.leads, stage).length, 0),
    [searchTerm, sortKey, sourceFilter, stages, statusFilter, urgencyFilter],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Drag to advance"
        title="Pipeline"
        description={`${totalLeads} active ${totalLeads === 1 ? 'lead' : 'leads'} · ${currency.format(totalValue)} in motion · ${currency.format(weightedValue)} weighted`}
        actions={
          <>
            <Button
              variant="ghost"
              size="lg"
              className="gap-2"
              onClick={() => router.push('/leads')}
            >
              <List className="h-4 w-4" /> List view
            </Button>
            <Link href="/leads/add">
              <Button size="lg" className="gap-2">
                <Plus className="h-4 w-4" /> New lead
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(140px,180px))_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads, contacts, sources…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
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
            <SelectItem value="stage-default">Stage default</SelectItem>
            <SelectItem value="value-desc">Highest value</SelectItem>
            <SelectItem value="urgency">Highest urgency</SelectItem>
            <SelectItem value="age-desc">Oldest lead</SelectItem>
            <SelectItem value="close-date">Expected close</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Visible deals
          </p>
          <p className="mt-1 font-display text-xl font-medium">
            {visibleLeads} of {totalLeads}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Pipeline value
          </p>
          <p className="mt-1 font-display text-xl font-medium">
            {currency.format(totalValue)}
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Weighted pipeline
          </p>
          <p className="mt-1 font-display text-xl font-medium">
            {currency.format(weightedValue)}
          </p>
        </div>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-6">
          {stages.map((stage, i) => {
            const filteredLeads = filterLeads(stage.leads, stage);
            const stageValue = filteredLeads.reduce((acc, l) => acc + (l.deal_value ?? 0), 0);
            const stageWeightedValue = filteredLeads.reduce(
              (acc, lead) =>
                acc +
                ((lead.deal_value ?? 0) *
                  getStageProbability(stage, stages.length, lead.status)) /
                  100,
              0,
            );
            const tone = stageTones[i % stageTones.length];

            return (
              <div key={stage.id} className="w-80 flex-none">
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card/60">
                  {/* Stage header */}
                  <div className="flex items-baseline justify-between gap-2 border-b px-5 pb-4 pt-5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn('h-2 w-2 rounded-full', tone.dot)}
                        aria-hidden
                      />
                      <h3 className="text-sm font-medium text-foreground">{stage.name}</h3>
                      <span className="text-xs text-muted-foreground">
                        · {filteredLeads.length}
                      </span>
                    </div>
                    {stageValue > 0 ? (
                      <div className="text-right">
                        <span className="font-display nums-tabular text-sm font-medium tabular-nums text-foreground">
                          {compact.format(stageValue)}
                        </span>
                        <p className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                          {compact.format(stageWeightedValue)} weighted
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <Droppable droppableId={stage.id}>
                    {(provided: DroppableProvided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={cn(
                          'flex-1 space-y-2 p-3 transition-colors',
                          snapshot.isDraggingOver && 'bg-accent/40',
                        )}
                        style={{ minHeight: 320 }}
                      >
                        {filteredLeads.length === 0 && !snapshot.isDraggingOver ? (
                          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed text-xs uppercase tracking-[0.2em] text-muted-foreground/60">
                            empty
                          </div>
                        ) : null}

                        {filteredLeads.map((lead, index) => {
                          const age = daysSince(lead.created_at);
                          const probability = getStageProbability(stage, stages.length, lead.status);
                          const urgency = getUrgency(lead, stage, stages.length);
                          const expectedClose = getExpectedCloseDate(lead, urgency, probability);
                          const riskCue = getRiskCue(lead, urgency, age, probability);

                          return (
                            <Draggable
                              key={lead.id}
                              draggableId={lead.id}
                              index={index}
                            >
                              {(dProvided: DraggableProvided, dSnapshot: DraggableStateSnapshot) => (
                                <div
                                  ref={dProvided.innerRef}
                                  {...dProvided.draggableProps}
                                  {...dProvided.dragHandleProps}
                                  className={cn(
                                    'group cursor-grab rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing',
                                    urgency === 'high' && 'border-destructive/30',
                                    dSnapshot.isDragging && 'is-dragging',
                                  )}
                                  style={dProvided.draggableProps.style}
                                  onClick={(e) => {
                                    if (e.defaultPrevented) return;
                                    if (dSnapshot.isDragging) return;
                                    router.push(`/leads/${lead.id}`);
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-0.5">
                                      <p className="truncate text-sm font-medium">
                                        {lead.company_name}
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {lead.contact_name}
                                      </p>
                                    </div>
                                    {typeof lead.deal_value === 'number' && lead.deal_value > 0 ? (
                                      <div className="shrink-0 text-right">
                                        <span className="font-display nums-tabular text-base font-medium tabular-nums">
                                          {compact.format(lead.deal_value)}
                                        </span>
                                        <p className="text-[0.65rem] text-muted-foreground">
                                          {probability}%
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    <span className="rounded-full border bg-background px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                                      {lead.status}
                                    </span>
                                    <span
                                      className={cn(
                                        'rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em]',
                                        urgencyTone[urgency],
                                      )}
                                    >
                                      {urgency}
                                    </span>
                                    {lead.source?.name ? (
                                      <span className="rounded-full border bg-background px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                                        {lead.source.name}
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Age</span>
                                      <span className="text-foreground">{age}d</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Close</span>
                                      <span className="text-foreground">
                                        {expectedClose
                                          ? expectedClose.toLocaleDateString('en-US', {
                                              month: 'short',
                                              day: 'numeric',
                                            })
                                          : 'TBD'}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Last</span>
                                      <span className="text-foreground">
                                        {formatRelativeDays(Math.max(0, Math.floor(age / 2)))}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                      <span>Next</span>
                                      <span className="truncate text-foreground">
                                        {getNextStep(lead.status)}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                                    <span
                                      className={cn(
                                        'truncate text-xs',
                                        urgency === 'high' ? 'text-destructive' : 'text-muted-foreground',
                                      )}
                                    >
                                      {riskCue}
                                    </span>
                                    <span
                                      aria-hidden
                                      className="text-xs text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                                    >
                                      →
                                    </span>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}

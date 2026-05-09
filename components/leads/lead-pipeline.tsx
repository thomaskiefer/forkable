'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
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
  current_stage_id: string;
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

export function LeadPipeline({
  initialStages,
  initialLeads,
}: {
  initialStages: LeadStage[];
  initialLeads: PipelineLead[];
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
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
      const [lead] = sourceStage.leads.splice(result.source.index, 1);
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

  const filterLeads = (leads: PipelineLead[]) => {
    if (!searchTerm) return leads;
    const term = searchTerm.toLowerCase();
    return leads.filter(
      (l) =>
        l.company_name.toLowerCase().includes(term) ||
        l.contact_name.toLowerCase().includes(term),
    );
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Drag to advance"
        title="Pipeline"
        description={`${totalLeads} active ${totalLeads === 1 ? 'lead' : 'leads'} · ${currency.format(totalValue)} in motion`}
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

      <div className="flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-11 pl-10"
          />
        </div>
        <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </Button>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-6">
          {stages.map((stage, i) => {
            const filteredLeads = filterLeads(stage.leads);
            const stageValue = filteredLeads.reduce((acc, l) => acc + (l.deal_value ?? 0), 0);
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
                      <span className="font-display nums-tabular text-sm font-medium tabular-nums text-foreground">
                        {compact.format(stageValue)}
                      </span>
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

                        {filteredLeads.map((lead, index) => (
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
                                    <span className="font-display nums-tabular shrink-0 text-base font-medium tabular-nums">
                                      {compact.format(lead.deal_value)}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-3 flex items-center justify-between">
                                  <span
                                    className={cn(
                                      'rounded-full border bg-background px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground',
                                    )}
                                  >
                                    {lead.status}
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
                        ))}
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

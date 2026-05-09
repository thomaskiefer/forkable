'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Plus, Search, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
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

export function LeadsList({
  initialLeads,
  initialCount,
}: {
  initialLeads: Lead[];
  initialCount: number;
}) {
  const [leads] = useState(initialLeads);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query) return leads;
    const q = query.toLowerCase();
    return leads.filter(
      (l) =>
        l.company_name.toLowerCase().includes(q) ||
        l.contact_name.toLowerCase().includes(q) ||
        l.contact_email?.toLowerCase().includes(q),
    );
  }, [leads, query]);

  const totalValue = useMemo(
    () => leads.reduce((sum, l) => sum + (l.deal_value ?? 0), 0),
    [leads],
  );

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        description={
          initialCount > 0
            ? `${initialCount} ${initialCount === 1 ? 'lead' : 'leads'} · ${currency.format(totalValue)} in pipeline`
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
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search leads, contacts, emails…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 pl-10"
          />
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
            No leads match <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="group flex items-center gap-6 px-6 py-5 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1 space-y-1">
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
                  </div>

                  <div className="flex shrink-0 items-center gap-5">
                    {typeof lead.deal_value === 'number' && lead.deal_value > 0 ? (
                      <span className="font-display nums-tabular text-lg font-medium tabular-nums">
                        {currency.format(lead.deal_value)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}

                    {lead.current_stage ? (
                      <span className="rounded-full border bg-card px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                        {lead.current_stage.name}
                      </span>
                    ) : null}

                    <span
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                        statusTone[lead.status] ?? statusTone.new,
                      )}
                    >
                      {lead.status}
                    </span>

                    <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

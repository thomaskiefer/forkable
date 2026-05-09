'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Building2,
  CheckCircle,
  DollarSign,
  Globe,
  Mail,
  Phone,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ACTIVITY_TYPES, FOLLOW_UP_PRIORITIES } from '@/lib/constants';
import type { DealApprovalRequest, Lead, LeadActivity, LeadFollowUp } from '@/lib/types';
import type { AcmeClosePlanActionKey, AcmeClosePlanItem } from '@/lib/types';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const statusTone: Record<string, string> = {
  new: 'bg-muted text-muted-foreground border-border',
  contacted: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  qualified: 'bg-primary/12 text-primary border-primary/30',
  unqualified: 'bg-destructive/10 text-destructive border-destructive/30',
};

const acmeClosePlanLabels: Record<AcmeClosePlanActionKey, string> = {
  confirm_legal_owner: 'Confirm legal owner',
  attach_security_notes: 'Attach security notes',
  schedule_procurement_follow_up: 'Schedule procurement follow-up',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
        statusTone[status] ?? statusTone.new,
      )}
    >
      {status}
    </span>
  );
}

function StagePill({ name }: { name: string }) {
  return (
    <span className="rounded-full border bg-card px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
      {name}
    </span>
  );
}

export function LeadDetail({
  lead,
  activities: initialActivities,
  followUps: initialFollowUps,
  approvals: initialApprovals,
  enterpriseApprovalsEnabled,
  acmeClosePlanEnabled,
  acmeClosePlanItems: initialAcmeClosePlanItems,
}: {
  lead: Lead;
  activities: LeadActivity[];
  followUps: LeadFollowUp[];
  approvals: DealApprovalRequest[];
  enterpriseApprovalsEnabled: boolean;
  acmeClosePlanEnabled: boolean;
  acmeClosePlanItems: AcmeClosePlanItem[];
}) {
  const router = useRouter();
  const [activities, setActivities] = useState(initialActivities);
  const [followUps, setFollowUps] = useState(initialFollowUps);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [acmeClosePlanItems, setAcmeClosePlanItems] = useState(initialAcmeClosePlanItems);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [closePlanLoading, setClosePlanLoading] = useState<AcmeClosePlanActionKey | null>(null);

  const activeApproval = approvals.find(
    (approval) => approval.status === 'pending' || approval.status === 'approved',
  );
  const approvalRequired = enterpriseApprovalsEnabled && lead.deal_value >= 50000;
  const acmeClosePlanRequired = acmeClosePlanEnabled && lead.deal_value >= 50000;
  const completedClosePlanItems = acmeClosePlanItems.filter((item) => item.completed_at).length;

  async function addActivity(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/leads/${lead.id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.get('type'),
          subject: form.get('subject'),
          description: form.get('description') || undefined,
          activity_date: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error();
      const activity = await res.json();
      setActivities([activity, ...activities]);
      setShowActivityForm(false);
      toast.success('Activity added');
    } catch {
      toast.error('Failed to add activity');
    }
  }

  async function addFollowUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/leads/${lead.id}/follow-ups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          due_date: form.get('due_date'),
          priority: form.get('priority'),
          description: form.get('description'),
        }),
      });
      if (!res.ok) throw new Error();
      const followUp = await res.json();
      setFollowUps([...followUps, followUp]);
      setShowFollowUpForm(false);
      toast.success('Follow-up created');
    } catch {
      toast.error('Failed to create follow-up');
    }
  }

  async function completeFollowUp(followUpId: string) {
    try {
      const res = await fetch(`/api/leads/${lead.id}/follow-ups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followUpId }),
      });
      if (!res.ok) throw new Error();
      setFollowUps(
        followUps.map((f) =>
          f.id === followUpId
            ? {
                ...f,
                status: 'completed' as const,
                completed_at: new Date().toISOString(),
              }
            : f,
        ),
      );
      toast.success('Follow-up completed');
    } catch {
      toast.error('Failed to complete follow-up');
    }
  }

  async function refreshApprovals() {
    const res = await fetch(`/api/leads/${lead.id}/approvals`);
    if (!res.ok) throw new Error('Failed to refresh approvals');
    const nextApprovals = await res.json();
    setApprovals(nextApprovals);
  }

  async function requestApproval() {
    setApprovalLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: `Legal Review required for ${currency.format(lead.deal_value)} deal.`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to request approval');
      }
      await refreshApprovals();
      toast.success('Legal Review requested');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to request approval');
    } finally {
      setApprovalLoading(false);
    }
  }

  async function approveRequest(approvalRequestId: string) {
    setApprovalLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/approvals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalRequestId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to approve request');
      }
      await refreshApprovals();
      toast.success('Legal Review approved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve request');
    } finally {
      setApprovalLoading(false);
    }
  }

  async function completeClosePlanItem(actionKey: AcmeClosePlanActionKey) {
    setClosePlanLoading(actionKey);
    try {
      const res = await fetch(`/api/leads/${lead.id}/acme-close-plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionKey,
          notes: acmeClosePlanLabels[actionKey],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to update close plan');
      }
      const items = await res.json();
      setAcmeClosePlanItems(items);
      toast.success('Close-plan action completed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update close plan');
    } finally {
      setClosePlanLoading(null);
    }
  }

  return (
    <div className="space-y-10">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      {/* Editorial header */}
      <header className="space-y-5">
        <p className="eyebrow">{lead.company_name}</p>
        <h1 className="font-display text-balance text-5xl font-medium leading-[0.95] tracking-tight sm:text-6xl">
          {lead.contact_name}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={lead.status} />
          {lead.current_stage ? <StagePill name={lead.current_stage.name} /> : null}
          {lead.deal_value > 0 ? (
            <span className="font-display nums-tabular text-base text-muted-foreground">
              {compact.format(lead.deal_value)} deal
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[0.9fr_2.1fr]">
        {/* Contact rail */}
        <aside className="space-y-6">
          <section className="rounded-2xl border bg-card/60 p-6 ring-warm">
            <p className="eyebrow mb-5">Contact</p>
            <dl className="space-y-3 text-sm">
              {lead.contact_email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="break-all">{lead.contact_email}</span>
                </div>
              )}
              {lead.contact_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{lead.contact_phone}</span>
                </div>
              )}
              {lead.contact_title && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{lead.contact_title}</span>
                </div>
              )}
              {lead.website && (
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{lead.website}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <DollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-display nums-tabular text-base font-medium tabular-nums">
                  {currency.format(lead.deal_value)}
                </span>
              </div>
            </dl>

            {(lead.industry || lead.source) && (
              <dl className="mt-5 space-y-2 border-t pt-5 text-xs text-muted-foreground">
                {lead.industry && (
                  <div className="flex justify-between gap-3">
                    <dt>Industry</dt>
                    <dd className="text-foreground">{lead.industry}</dd>
                  </div>
                )}
                {lead.source && (
                  <div className="flex justify-between gap-3">
                    <dt>Source</dt>
                    <dd className="text-foreground">{lead.source.name}</dd>
                  </div>
                )}
              </dl>
            )}
          </section>

          {lead.notes ? (
            <section className="rounded-2xl border bg-card/40 p-6">
              <p className="eyebrow mb-3">Notes</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {lead.notes}
              </p>
            </section>
          ) : null}
        </aside>

        {/* Main column */}
        <div className="space-y-10">
          {/* Activities */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-medium tracking-tight">Activity</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowActivityForm(!showActivityForm)}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {showActivityForm ? 'Close' : 'Add activity'}
              </Button>
            </div>

            {showActivityForm && (
              <form
                onSubmit={addActivity}
                className="space-y-4 rounded-2xl border bg-card/60 p-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select name="type" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Subject</Label>
                    <Input name="subject" required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea name="description" rows={2} />
                </div>
                <Button type="submit" size="sm">
                  Save activity
                </Button>
              </form>
            )}

            {activities.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                No activity logged yet.
              </p>
            ) : (
              <ol className="relative space-y-1 border-l pl-6">
                {activities.map((a) => (
                  <li key={a.id} className="relative pb-5">
                    <span
                      aria-hidden
                      className="absolute -left-[27px] top-1.5 h-2 w-2 rounded-full bg-primary ring-4 ring-background"
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border bg-card px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                            {a.type}
                          </span>
                          <span className="font-medium">{a.subject}</span>
                        </div>
                        {a.description && (
                          <p className="text-sm text-muted-foreground">{a.description}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(new Date(a.activity_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Approvals */}
          {enterpriseApprovalsEnabled && (
            <section
              className={cn(
                'space-y-4 rounded-2xl border p-6',
                approvalRequired ? 'border-destructive/30 bg-destructive/5' : 'bg-card/40',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="eyebrow flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5" /> Enterprise approval
                  </p>
                  <h3 className="font-display text-xl font-medium tracking-tight">
                    {approvalRequired ? 'Legal Review required' : 'No approval needed'}
                  </h3>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Deals over $50k need Legal Review before Contract Sent or Closed Won.
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                    approvalRequired
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {approvalRequired ? 'Required' : 'Not required'}
                </span>
              </div>

              <div className="rounded-xl border bg-background p-4">
                {activeApproval ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Legal Review</p>
                      <p className="text-sm text-muted-foreground">
                        {activeApproval.status === 'approved'
                          ? `Approved ${activeApproval.approved_at ? format(new Date(activeApproval.approved_at), 'MMM d, yyyy HH:mm') : ''}`
                          : `Requested ${format(new Date(activeApproval.created_at), 'MMM d, yyyy HH:mm')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.18em]',
                          activeApproval.status === 'approved'
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {activeApproval.status}
                      </span>
                      {activeApproval.status === 'pending' && (
                        <Button
                          size="sm"
                          onClick={() => approveRequest(activeApproval.id)}
                          disabled={approvalLoading}
                        >
                          Approve
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      {approvalRequired
                        ? 'Request approval before advancing this deal.'
                        : 'This deal can move through the pipeline normally.'}
                    </p>
                    {approvalRequired && (
                      <Button onClick={requestApproval} disabled={approvalLoading}>
                        Request Legal Review
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {acmeClosePlanEnabled && (
            <section
              className={cn(
                'space-y-4 rounded-2xl border p-6',
                acmeClosePlanRequired ? 'border-primary/30 bg-primary/5' : 'bg-card/40',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="eyebrow flex items-center gap-2">
                    <CheckCircle className="h-3.5 w-3.5" /> Acme close plan
                  </p>
                  <h3 className="font-display text-xl font-medium tracking-tight">
                    {completedClosePlanItems} of 3 actions complete
                  </h3>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Enterprise deals need these actions before Contract Sent or Closed Won.
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em]',
                    completedClosePlanItems === 3
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {completedClosePlanItems === 3 ? 'Ready' : 'Open'}
                </span>
              </div>

              <div className="divide-y rounded-xl border bg-background">
                {acmeClosePlanItems.map((item) => {
                  const actionKey = item.action_key;
                  const completed = Boolean(item.completed_at);
                  return (
                    <div
                      key={actionKey}
                      className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{acmeClosePlanLabels[actionKey]}</p>
                        <p className="text-sm text-muted-foreground">
                          {completed && item.completed_at
                            ? `Completed ${format(new Date(item.completed_at), 'MMM d, yyyy HH:mm')}`
                            : 'Required before late-stage movement.'}
                        </p>
                      </div>
                      {completed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-primary">
                          <CheckCircle className="h-3 w-3" /> Done
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => completeClosePlanItem(actionKey)}
                          disabled={closePlanLoading === actionKey}
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Follow-ups */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-medium tracking-tight">Follow-ups</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowFollowUpForm(!showFollowUpForm)}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {showFollowUpForm ? 'Close' : 'Add follow-up'}
              </Button>
            </div>

            {showFollowUpForm && (
              <form
                onSubmit={addFollowUp}
                className="space-y-4 rounded-2xl border bg-card/60 p-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Due</Label>
                    <Input name="due_date" type="datetime-local" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select name="priority" defaultValue="medium">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FOLLOW_UP_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>What needs to happen?</Label>
                  <Textarea name="description" required rows={2} />
                </div>
                <Button type="submit" size="sm">
                  Create follow-up
                </Button>
              </form>
            )}

            {followUps.length === 0 ? (
              <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                Nothing scheduled.
              </p>
            ) : (
              <Card className="overflow-hidden p-0">
                <CardContent className="p-0">
                  <div className="divide-y">
                    {followUps.map((f) => (
                      <div
                        key={f.id}
                        className={cn(
                          'flex items-center justify-between gap-4 px-5 py-4',
                          f.status === 'completed' && 'opacity-50',
                        )}
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium">{f.description}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{format(new Date(f.due_date), 'MMM d, yyyy HH:mm')}</span>
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.18em]',
                                f.priority === 'high'
                                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                                  : 'border-border',
                              )}
                            >
                              {f.priority}
                            </span>
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.18em]',
                                f.status === 'completed'
                                  ? 'border-primary/30 bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground',
                              )}
                            >
                              {f.status}
                            </span>
                          </div>
                        </div>
                        {f.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => completeFollowUp(f.id)}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </div>

    </div>
  );
}

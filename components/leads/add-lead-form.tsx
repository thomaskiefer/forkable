'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { LeadSource, LeadStage } from '@/lib/types';

function FieldGroup({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t pt-8 lg:grid-cols-[0.9fr_2fr]">
      <header className="space-y-2">
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="font-display text-xl font-medium tracking-tight">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function AddLeadForm({
  sources,
  stages,
}: {
  sources: LeadSource[];
  stages: LeadStage[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const body = {
      company_name: form.get('company_name'),
      contact_name: form.get('contact_name'),
      contact_email: form.get('contact_email') || undefined,
      contact_phone: form.get('contact_phone') || undefined,
      contact_title: form.get('contact_title') || undefined,
      industry: form.get('industry') || undefined,
      website: form.get('website') || undefined,
      source_id: form.get('source_id'),
      current_stage_id: form.get('current_stage_id') || stages[0]?.id,
      deal_value: Number(form.get('deal_value') || 0),
      notes: form.get('notes') || undefined,
    };

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Failed to create lead');

      toast.success('Lead created');
      router.push('/leads');
      router.refresh();
    } catch {
      toast.error('Failed to create lead');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <FieldGroup
        eyebrow="Step 01"
        title="Contact"
        description="Who are you talking to, and where can you reach them?"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contact_name">Contact name *</Label>
            <Input id="contact_name" name="contact_name" required placeholder="Riley Chen" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company_name">Company *</Label>
            <Input id="company_name" name="company_name" required placeholder="Shopify" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_email">Email</Label>
            <Input
              id="contact_email"
              name="contact_email"
              type="email"
              placeholder="riley@acme.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_phone">Phone</Label>
            <Input id="contact_phone" name="contact_phone" placeholder="+1 555 0123" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_title">Title</Label>
            <Input id="contact_title" name="contact_title" placeholder="Head of operations" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" placeholder="acme.com" />
          </div>
        </div>
      </FieldGroup>

      <FieldGroup
        eyebrow="Step 02"
        title="Deal"
        description="Sizing, source, and where this sits in your pipeline."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="deal_value">Deal value (USD)</Label>
            <Input
              id="deal_value"
              name="deal_value"
              type="number"
              min="0"
              step="1000"
              placeholder="120000"
              className="nums-tabular"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="industry">Industry</Label>
            <Input id="industry" name="industry" placeholder="Logistics" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source_id">Source *</Label>
            <Select name="source_id" required>
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="current_stage_id">Stage</Label>
            <Select name="current_stage_id" defaultValue={stages[0]?.id}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FieldGroup>

      <FieldGroup
        eyebrow="Step 03"
        title="Context"
        description="Anything you want to remember when you come back to this in two weeks."
      >
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Met at the conference. They're evaluating us against two other vendors…"
          />
        </div>
      </FieldGroup>

      <div className="flex flex-wrap items-center gap-3 border-t pt-8">
        <Button type="submit" size="lg" disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {loading ? 'Creating…' : 'Create lead'}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

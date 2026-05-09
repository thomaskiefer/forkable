'use client';

import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ChangeRequest } from '@/lib/types';

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Unable to create request.';
  } catch {
    return 'Unable to create request.';
  }
}

export function FeatureRequestIntakeForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    let shouldResetSubmitting = true;

    const form = event.currentTarget;
    const formData = new FormData(form);

    try {
      const response = await fetch('/api/feature-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(formData.get('title') ?? ''),
          description: String(formData.get('description') ?? ''),
        }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));

      const body = (await response.json()) as { request: ChangeRequest };
      toast.success('Feature request created.');
      shouldResetSubmitting = false;
      router.push(`/feature-requests?request=${body.request.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create request.');
    } finally {
      if (shouldResetSubmitting) {
        setIsSubmitting(false);
      }
    }
  }

  return (
    <form
      onSubmit={submitRequest}
      className="w-full max-w-2xl rounded-[1.15rem] border bg-card p-7 sm:p-8 dark:border-white/[0.12] dark:bg-[#070707]/88"
    >
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">New feature request</p>
        <h1 className="font-display text-2xl font-medium tracking-tight">
          Start with your company's workflow request
        </h1>
      </div>

      <div className="mt-7 space-y-5">
        <div className="space-y-3">
          <Label htmlFor="title">Request title</Label>
          <Input
            id="title"
            name="title"
            className="h-11 px-4"
            placeholder="Enterprise Deal Approval Gate"
            required
          />
        </div>

        <div className="space-y-3">
          <Label htmlFor="description">Workflow request</Label>
          <Textarea
            id="description"
            name="description"
            className="min-h-28 resize-none px-4 py-3"
            placeholder="Any deal over $50k must go through Legal Review before it can move to Contract Sent or Closed Won."
            required
          />
        </div>
      </div>

      <div className="mt-7 flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Create request
        </Button>
      </div>
    </form>
  );
}

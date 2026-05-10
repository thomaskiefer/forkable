'use client';

import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ScheduledAgentTask } from '@/lib/types';

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Request failed.';
  } catch {
    return 'Request failed.';
  }
}

export function CreateAutomationButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  async function createAutomation() {
    setIsCreating(true);
    let shouldResetCreating = true;

    try {
      const response = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Automation setup',
          status: 'draft',
        }),
      });

      if (!response.ok) throw new Error(await getErrorMessage(response));
      const body = (await response.json()) as { task?: ScheduledAgentTask };
      if (!body.task) throw new Error('Automation was not created.');
      toast.success('Describe what should happen and when.');
      shouldResetCreating = false;
      router.push(`/automations?task=${body.task.id}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create automation.');
    } finally {
      if (shouldResetCreating) {
        setIsCreating(false);
      }
    }
  }

  return (
    <Button onClick={createAutomation} disabled={isCreating}>
      {isCreating ? <Loader2 className="animate-spin" /> : <Plus />}
      New
    </Button>
  );
}

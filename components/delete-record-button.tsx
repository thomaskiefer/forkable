'use client';

import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

async function getErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'Delete failed.';
  } catch {
    return 'Delete failed.';
  }
}

export function DeleteRecordButton({
  endpoint,
  label,
  redirectTo,
}: {
  endpoint: string;
  label: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteRecord() {
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    setIsDeleting(true);
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) throw new Error(await getErrorMessage(response));

      toast.success(`${label} deleted.`);
      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to delete ${label}.`);
      setIsDeleting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      onClick={deleteRecord}
      disabled={isDeleting}
      aria-label={`Delete ${label}`}
      title={`Delete ${label}`}
    >
      {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

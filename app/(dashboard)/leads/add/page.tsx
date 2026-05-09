import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AddLeadForm } from '@/components/leads/add-lead-form';
import { PageHeader } from '@/components/ui/page-header';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getLeadSources, getLeadStages } from '@/lib/queries';

export default async function AddLeadPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const [sources, stages] = await Promise.all([
    getLeadSources(token),
    getLeadStages(token),
  ]);

  return (
    <div className="space-y-10">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to leads
      </Link>

      <PageHeader
        eyebrow="New entry"
        title="Add a lead"
        description="Capture the contact, the company, and a deal value. You can refine the rest later."
      />

      <AddLeadForm sources={sources} stages={stages} />
    </div>
  );
}

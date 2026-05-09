import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getLeadStages, getLeadsByStage } from '@/lib/queries';
import { LeadPipeline } from '@/components/leads/lead-pipeline';

export default async function PipelinePage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const [stages, leads] = await Promise.all([
    getLeadStages(token),
    getLeadsByStage(token),
  ]);

  return <LeadPipeline initialStages={stages} initialLeads={leads} />;
}

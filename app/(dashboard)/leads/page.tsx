import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getLeads } from '@/lib/queries';
import { LeadsList } from '@/components/leads/leads-list';

export default async function LeadsPage() {
  const { accessToken: token } = await requireAuthenticatedSession();
  const { leads, count } = await getLeads(token, 1, 50);

  return <LeadsList initialLeads={leads} initialCount={count} />;
}

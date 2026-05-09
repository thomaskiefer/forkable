import { notFound } from 'next/navigation';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import {
  getAcmeClosePlanItems,
  getDealApprovalRequests,
  getLead,
  getLeadActivities,
  getLeadFollowUps,
  leadHasFeatureFlag,
} from '@/lib/queries';
import { LeadDetail } from '@/components/leads/lead-detail';

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { accessToken: token, viewer } = await requireAuthenticatedSession();

  const [
    lead,
    activities,
    followUps,
    approvals,
    enterpriseApprovalsEnabled,
    acmeClosePlanEnabled,
  ] = await Promise.all([
    getLead(id, token),
    getLeadActivities(id, token),
    getLeadFollowUps(id, token),
    getDealApprovalRequests(id, token),
    leadHasFeatureFlag(id, 'enterprise_deal_approvals', viewer.id!, token),
    leadHasFeatureFlag(id, 'acme_dashboard_close_plan', viewer.id!, token),
  ]);

  if (!lead) notFound();

  const acmeClosePlanItems = acmeClosePlanEnabled
    ? await getAcmeClosePlanItems(id, token)
    : [];

  return (
    <LeadDetail
      lead={lead}
      activities={activities}
      followUps={followUps}
      approvals={approvals}
      enterpriseApprovalsEnabled={enterpriseApprovalsEnabled}
      acmeClosePlanEnabled={acmeClosePlanEnabled}
      acmeClosePlanItems={acmeClosePlanItems}
    />
  );
}

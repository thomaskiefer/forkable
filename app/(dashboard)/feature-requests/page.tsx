import Link from 'next/link';
import { Plus } from 'lucide-react';
import { DeleteRecordButton } from '@/components/delete-record-button';
import { FeatureRequestIntakeForm } from '@/components/feature-planning/feature-request-intake-form';
import { FeaturePlanningChat } from '@/components/feature-planning/feature-planning-chat';
import { Button } from '@/components/ui/button';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import {
  getAgentRunsForRequest,
  getChangeRequests,
  getLatestChangeRequestPlan,
  getPlanningMessages,
} from '@/lib/queries';
import type {
  AgentRun,
  ChangeRequest,
  ChangeRequestPlan,
  ChangeRequestPlanningMessage,
} from '@/lib/types';
import { cn } from '@/lib/utils';

function getSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FeatureRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ request?: string | string[]; new?: string | string[] }>;
}) {
  const { accessToken: token } = await requireAuthenticatedSession();
  const params = await searchParams;
  const requests = (await getChangeRequests(token)) as ChangeRequest[];
  const selectedId = getSearchValue(params?.request);
  const isCreatingNew = getSearchValue(params?.new) === '1';
  const selectedRequest =
    isCreatingNew
      ? null
      : requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;

  const [runs, messages, plan] = selectedRequest
    ? await Promise.all([
        getAgentRunsForRequest(selectedRequest.id, token) as Promise<AgentRun[]>,
        getPlanningMessages(selectedRequest.id, token) as Promise<ChangeRequestPlanningMessage[]>,
        getLatestChangeRequestPlan(selectedRequest.id, token) as Promise<ChangeRequestPlan | null>,
      ])
    : [[], [], null];

  const latestRun = runs[0] ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[640px] flex-col">
      {requests.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4">
          <FeatureRequestIntakeForm />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.15rem] border bg-card shadow-[0_30px_90px_rgba(0,0,0,0.18)] dark:border-white/[0.12] dark:bg-[#070707]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
            <div className="flex items-center justify-between gap-3 border-b p-3 dark:border-white/10">
              <h1 className="text-sm font-semibold">Requests</h1>
              <Button asChild size="sm" className="h-8 shrink-0 px-3">
                <Link href="/feature-requests?new=1">
                  <Plus />
                  New request
                </Link>
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {requests.map((request) => {
                const isSelected = request.id === selectedRequest?.id;

                return (
                  <div
                    key={request.id}
                    className={cn(
                      'flex items-start gap-2 border-b px-3 py-3 transition-colors',
                      'dark:border-white/10',
                      isSelected
                        ? 'bg-accent/45 dark:bg-white/[0.08]'
                        : 'hover:bg-accent/25 dark:hover:bg-white/[0.055]',
                    )}
                  >
                    <Link
                      href={`/feature-requests?request=${request.id}`}
                      aria-current={isSelected ? 'page' : undefined}
                      className="min-w-0 flex-1 space-y-1"
                    >
                      <p className="line-clamp-2 text-sm font-medium leading-5">
                        {request.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {request.customer_name}
                      </p>
                    </Link>
                    <DeleteRecordButton
                      endpoint={`/api/feature-requests/${request.id}`}
                      label="feature request"
                      redirectTo="/feature-requests"
                    />
                  </div>
                );
              })}
            </div>
          </aside>

          {isCreatingNew || !selectedRequest ? (
            <section className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[1.15rem] border bg-card p-4 shadow-[0_30px_90px_rgba(0,0,0,0.18)] dark:border-white/[0.12] dark:bg-[#070707]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
              <FeatureRequestIntakeForm />
            </section>
          ) : (
            <FeaturePlanningChat
              key={selectedRequest.id}
              request={selectedRequest}
              initialMessages={messages}
              initialPlan={plan}
              latestRun={latestRun}
            />
          )}
        </div>
      )}
    </div>
  );
}

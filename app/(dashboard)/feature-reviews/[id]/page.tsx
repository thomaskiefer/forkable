import { notFound } from 'next/navigation';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getAgentRun, getBranchPreview, getTestResults } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentRun, BranchPreview, TestResult } from '@/lib/types';

function countChangedFiles(summary?: string) {
  const match = summary?.match(/(?:files changed|changed files):?\s*(\d+)/i);
  return match?.[1] ?? null;
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { accessToken: token } = await requireAuthenticatedSession();
  const run = (await getAgentRun(id, token)) as AgentRun | null;
  if (!run) notFound();

  const [preview, tests] = await Promise.all([
    getBranchPreview(id, token) as Promise<BranchPreview | null>,
    getTestResults(id, token) as Promise<TestResult[]>,
  ]);
  const planSnapshot = run.plan_snapshot as {
    summary?: string;
    acceptance_criteria?: string[];
  } | undefined;
  const passed = tests.filter((test) => test.status === 'passed').length;
  const failed = tests.filter((test) => test.status === 'failed').length;
  const changedFiles = countChangedFiles(run.output_summary);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Feature shipment</p>
        <h1 className="text-2xl font-bold">{planSnapshot?.summary ?? 'Customization run'}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Code diff', changedFiles ? `${changedFiles} files changed` : run.commit_sha ? 'Commit ready' : 'No commit recorded'],
          ['Schema diff', 'Agent summary'],
          ['Smoke tests', `${passed}/${tests.length} passed`],
          ['Run status', failed > 0 ? 'Failed checks' : run.status],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="font-semibold">{value}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shipment package</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between rounded-md border p-3">
            <span>Git branch</span>
            <span className="font-medium">{run.git_branch}</span>
          </div>
          <div className="flex justify-between rounded-md border p-3">
            <span>InsForge backend branch</span>
            <span className="font-medium">{run.backend_branch}</span>
          </div>
          {preview && (
            <div className="flex justify-between rounded-md border p-3">
              <span>Preview URL</span>
              <span className="font-medium">{preview.app_url}</span>
            </div>
          )}
          {run.commit_sha ? (
            <div className="flex justify-between rounded-md border p-3">
              <span>Commit</span>
              <span className="font-medium">{run.commit_sha}</span>
            </div>
          ) : null}
          {run.output_summary ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 font-medium">Agent summary</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{run.output_summary}</p>
            </div>
          ) : null}
          {planSnapshot?.acceptance_criteria?.length ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 font-medium">Acceptance criteria</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {planSnapshot.acceptance_criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button disabled>
          {run.status === 'merged' ? 'Merged and feature flag enabled' : 'Automatic merge pending'}
        </Button>
        <Button variant="outline" disabled>
          Notification sent after merge
        </Button>
      </div>
    </div>
  );
}

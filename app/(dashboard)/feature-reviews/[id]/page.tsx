import { notFound } from 'next/navigation';
import { requireAuthenticatedSession } from '@/lib/auth-state';
import { getAgentRun, getBranchPreview, getTestResults } from '@/lib/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentRun, BranchPreview, TestResult } from '@/lib/types';

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
  const passed = tests.filter((test) => test.status === 'passed').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Feature review</p>
        <h1 className="text-2xl font-bold">Shopify approval workflow</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Code diff', '7 files changed'],
          ['Schema diff', '3 approval tables'],
          ['Smoke tests', `${passed}/${tests.length} passed`],
          ['Merge dry-run', '0 conflicts'],
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
          <CardTitle>Review package</CardTitle>
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
          <div className="flex justify-between rounded-md border p-3">
            <span>RLS policies</span>
            <Badge>added</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button>Approve and enable for Shopify Enterprise Sales</Button>
        <Button variant="outline">Reject</Button>
      </div>
    </div>
  );
}

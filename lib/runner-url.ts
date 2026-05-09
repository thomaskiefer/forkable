const KNOWN_RUNNER_ENDPOINTS = [
  /\/health$/,
  /\/run-once$/,
  /\/planning-chat$/,
  /\/automation-setup$/,
  /\/scheduled-tasks\/tick$/,
  /\/scheduled-tasks\/[^/]+\/run-now$/,
  /\/agent-runs\/[^/]+\/stream$/,
];

export function normalizeRunnerUrl(rawUrl?: string | null) {
  const initialValue = rawUrl?.trim().replace(/\/+$/, '');
  if (!initialValue) return undefined;

  let value = initialValue;
  let changed = true;
  while (changed) {
    changed = false;
    for (const endpoint of KNOWN_RUNNER_ENDPOINTS) {
      const next = value.replace(endpoint, '');
      if (next !== value) {
        value = next.replace(/\/+$/, '');
        changed = true;
      }
    }
  }

  return value || undefined;
}

export function runnerEndpointUrl(baseUrl: string, endpoint: string) {
  return `${normalizeRunnerUrl(baseUrl) ?? baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

export function runnerRequestError(endpoint: string, status: number, error?: string) {
  if (status === 404 && error === 'Not found') {
    return `Forkable runner did not recognize ${endpoint}. Check FORKABLE_AGENT_RUNNER_URL points to the runner base URL, then redeploy the current worker/agent-runner service.`;
  }

  return error || `Forkable runner request to ${endpoint} failed.`;
}

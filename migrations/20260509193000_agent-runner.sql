ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS runner_mode text NOT NULL DEFAULT 'insforge_compute',
  ADD COLUMN IF NOT EXISTS runner_id text,
  ADD COLUMN IF NOT EXISTS runner_job_id text,
  ADD COLUMN IF NOT EXISTS runner_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS runner_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS runner_error text,
  ADD COLUMN IF NOT EXISTS output_summary text,
  ADD COLUMN IF NOT EXISTS pull_request_url text,
  ADD COLUMN IF NOT EXISTS commit_sha text;

CREATE INDEX IF NOT EXISTS agent_runs_status_started_idx
  ON public.agent_runs (status, started_at);


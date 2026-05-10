CREATE TABLE IF NOT EXISTS public.agent_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('status', 'thinking', 'tool', 'edit', 'check', 'summary', 'error')),
  title text NOT NULL,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_run_events_run_created_idx
  ON public.agent_run_events (run_id, created_at, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_run_events TO authenticated;

ALTER TABLE public.agent_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_agent_run_events"
  ON public.agent_run_events;
CREATE POLICY "auth_user_own_agent_run_events"
  ON public.agent_run_events FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

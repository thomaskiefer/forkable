CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (btrim(title) <> ''),
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'info'
    CHECK (kind IN ('info', 'success', 'warning', 'error')),
  source_type text NOT NULL DEFAULT 'system'
    CHECK (source_type IN ('system', 'scheduled_agent', 'agent_run', 'feature_request')),
  status text NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'archived')),
  action_label text,
  action_href text,
  scheduled_task_id uuid REFERENCES public.scheduled_agent_tasks(id) ON DELETE SET NULL,
  scheduled_execution_id uuid REFERENCES public.scheduled_agent_executions(id) ON DELETE SET NULL,
  change_request_id uuid REFERENCES public.change_requests(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.change_request_plans(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_status_idx
  ON public.user_notifications (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_notifications_scheduled_execution_idx
  ON public.user_notifications (scheduled_execution_id);
CREATE INDEX IF NOT EXISTS user_notifications_agent_run_idx
  ON public.user_notifications (agent_run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_notifications TO authenticated;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_user_notifications"
  ON public.user_notifications;
CREATE POLICY "auth_user_own_user_notifications"
  ON public.user_notifications FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

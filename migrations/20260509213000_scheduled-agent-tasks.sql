ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'scheduled')),
  ADD COLUMN IF NOT EXISTS scheduled_task_id uuid,
  ADD COLUMN IF NOT EXISTS scheduled_execution_id uuid;

CREATE TABLE IF NOT EXISTS public.scheduled_agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (btrim(title) <> ''),
  name text,
  description text NOT NULL DEFAULT '',
  instructions text,
  prompt text,
  customer_name text NOT NULL DEFAULT '',
  customer_email text NOT NULL DEFAULT '',
  task_type text NOT NULL DEFAULT 'monitor_context'
    CHECK (task_type IN ('monitor_context', 'queue_agent', 'report_only')),
  feature_key text REFERENCES public.feature_flags(key) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  schedule_type text NOT NULL DEFAULT 'manual'
    CHECK (schedule_type IN ('manual', 'once', 'hourly', 'daily', 'weekly', 'monthly', 'cron')),
  schedule text,
  schedule_label text,
  rrule text,
  cron_expression text,
  timezone text NOT NULL DEFAULT 'UTC',
  change_request_id uuid REFERENCES public.change_requests(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.change_request_plans(id) ON DELETE SET NULL,
  next_run_at timestamptz,
  last_run_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  draft_prompt text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scheduled_agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.scheduled_agent_tasks(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL CHECK (btrim(content) <> ''),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.scheduled_agent_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.scheduled_agent_tasks(id) ON DELETE CASCADE,
  change_request_id uuid REFERENCES public.change_requests(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.change_request_plans(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  runner_id text,
  result_summary text,
  error_message text,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_scheduled_task_id_fkey,
  ADD CONSTRAINT agent_runs_scheduled_task_id_fkey
    FOREIGN KEY (scheduled_task_id)
    REFERENCES public.scheduled_agent_tasks(id)
    ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS agent_runs_scheduled_execution_id_fkey,
  ADD CONSTRAINT agent_runs_scheduled_execution_id_fkey
    FOREIGN KEY (scheduled_execution_id)
    REFERENCES public.scheduled_agent_executions(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS scheduled_agent_tasks_user_status_idx
  ON public.scheduled_agent_tasks (user_id, status, next_run_at);
CREATE INDEX IF NOT EXISTS scheduled_agent_tasks_next_run_idx
  ON public.scheduled_agent_tasks (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS scheduled_agent_tasks_change_request_idx
  ON public.scheduled_agent_tasks (change_request_id);
CREATE INDEX IF NOT EXISTS scheduled_agent_messages_task_idx
  ON public.scheduled_agent_messages (task_id, sort_order);
CREATE INDEX IF NOT EXISTS scheduled_agent_executions_task_idx
  ON public.scheduled_agent_executions (task_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS scheduled_agent_executions_status_idx
  ON public.scheduled_agent_executions (status, scheduled_for);
CREATE INDEX IF NOT EXISTS agent_runs_trigger_idx
  ON public.agent_runs (trigger_type, scheduled_task_id, scheduled_execution_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_agent_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_agent_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scheduled_agent_executions TO authenticated;

ALTER TABLE public.scheduled_agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_agent_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_scheduled_agent_tasks"
  ON public.scheduled_agent_tasks;
CREATE POLICY "auth_user_own_scheduled_agent_tasks"
  ON public.scheduled_agent_tasks FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auth_user_own_scheduled_agent_messages"
  ON public.scheduled_agent_messages;
CREATE POLICY "auth_user_own_scheduled_agent_messages"
  ON public.scheduled_agent_messages FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auth_user_own_scheduled_agent_executions"
  ON public.scheduled_agent_executions;
CREATE POLICY "auth_user_own_scheduled_agent_executions"
  ON public.scheduled_agent_executions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.seed_scheduled_agents_demo(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id uuid;
BEGIN
  SELECT id INTO v_task_id
  FROM public.scheduled_agent_tasks
  WHERE user_id = p_user_id
    AND title = 'Acme approval policy monitor'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_task_id IS NULL THEN
    INSERT INTO public.scheduled_agent_tasks (
      title,
      name,
      description,
      instructions,
      prompt,
      customer_name,
      customer_email,
      task_type,
      feature_key,
      status,
      schedule_type,
      schedule_label,
      cron_expression,
      timezone,
      next_run_at,
      metadata,
      context_snapshot,
      user_id
    )
    VALUES (
      'Acme approval policy monitor',
      'Acme approval policy monitor',
      'Checks Acme Slack for approval threshold, reviewer, SLA, or blocked-stage changes and queues a reviewable product change when policy changes.',
      'Every weekday at 8am, check Acme Slack for changes to the approval threshold, legal reviewer, SLA, or blocked pipeline stages. If anything changed, create a feature request and draft a Nia-grounded implementation plan.',
      'Monitor Acme Slack for approval policy changes. Use Hyperspell for Slack/customer context, then require Nia codebase planning before implementation.',
      'Acme',
      'acme@forkable.site',
      'monitor_context',
      'enterprise_deal_approvals',
      'active',
      'cron',
      'Weekdays at 8:00 AM',
      '0 8 * * 1-5',
      'America/Los_Angeles',
      now() + interval '5 minutes',
      jsonb_build_object('source', 'demo_seed', 'slack_channel', '#acme-legal-review'),
      jsonb_build_object(
        'hyperspell_expected_context',
        jsonb_build_array('threshold', 'legal reviewer', 'SLA', 'blocked pipeline stages'),
        'nia_expected_context',
        jsonb_build_array('lead detail UI', 'pipeline stage update route', 'approval RPC', 'migrations and RLS')
      ),
      p_user_id
    )
    RETURNING id INTO v_task_id;
  END IF;

  IF v_task_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.scheduled_agent_messages
      WHERE task_id = v_task_id
        AND user_id = p_user_id
    )
  THEN
    INSERT INTO public.scheduled_agent_messages (
      task_id,
      role,
      content,
      sort_order,
      metadata,
      user_id
    )
    VALUES
      (
        v_task_id,
        'user',
        'Every weekday at 8am, check Acme Slack for changes to the approval threshold, legal reviewer, SLA, or blocked pipeline stages. If anything changed, create a feature request and draft a Nia-grounded implementation plan.',
        0,
        '{}'::jsonb,
        p_user_id
      ),
      (
        v_task_id,
        'assistant',
        'Scheduled. I will use Hyperspell for Acme Slack context, then require Nia-grounded code impact planning before any agent run is queued.',
        1,
        jsonb_build_object('context_sources', jsonb_build_array('Hyperspell Slack', 'Nia repo context')),
        p_user_id
      );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_scheduled_agents_demo(uuid) TO authenticated;

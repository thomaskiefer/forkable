CREATE TABLE IF NOT EXISTS public.change_request_planning_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL CHECK (btrim(content) <> ''),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_request_id, sort_order)
);

CREATE TABLE IF NOT EXISTS public.change_request_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'finalized', 'sent_to_agent')),
  summary text NOT NULL DEFAULT '',
  implementation_plan text NOT NULL DEFAULT '',
  acceptance_criteria text[] NOT NULL DEFAULT '{}'::text[],
  coding_agent_prompt text NOT NULL DEFAULT '',
  context_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  finalized_at timestamptz,
  sent_to_agent_at timestamptz,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (change_request_id)
);

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.change_request_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS planning_messages_request_idx
  ON public.change_request_planning_messages (change_request_id, sort_order);
CREATE INDEX IF NOT EXISTS change_request_plans_request_idx
  ON public.change_request_plans (change_request_id);
CREATE INDEX IF NOT EXISTS agent_runs_plan_idx
  ON public.agent_runs (plan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_request_planning_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_request_plans TO authenticated;

ALTER TABLE public.change_request_planning_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_request_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_planning_messages"
  ON public.change_request_planning_messages;
CREATE POLICY "auth_user_own_planning_messages"
  ON public.change_request_planning_messages FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auth_user_own_change_request_plans"
  ON public.change_request_plans;
CREATE POLICY "auth_user_own_change_request_plans"
  ON public.change_request_plans FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.seed_forkable_planning_demo(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_request_id uuid;
  v_plan_id uuid;
BEGIN
  SELECT id INTO v_request_id
  FROM public.change_requests
  WHERE user_id = p_user_id
    AND feature_key = 'enterprise_deal_approvals'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_request_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.change_request_planning_messages
    WHERE change_request_id = v_request_id
      AND user_id = p_user_id
  ) THEN
    INSERT INTO public.change_request_planning_messages (
      change_request_id,
      role,
      content,
      sort_order,
      user_id
    )
    VALUES
      (
        v_request_id,
        'assistant',
        'I can help refine this into a coding-agent-ready plan. I will check scope, rollout, enforcement, and test criteria before we queue the implementation.',
        0,
        p_user_id
      ),
      (
        v_request_id,
        'user',
        'Keep it Acme-only, require backend enforcement, and make sure BetaCorp keeps the normal CRM behavior.',
        1,
        p_user_id
      ),
      (
        v_request_id,
        'assistant',
        'Understood. The plan should add an Acme-scoped feature flag, approval persistence, database enforcement for high-value stage moves, a small approval UI on lead detail, and smoke tests that prove Acme and BetaCorp diverge only where intended.',
        2,
        p_user_id
      );
  END IF;

  INSERT INTO public.change_request_plans (
    change_request_id,
    status,
    summary,
    implementation_plan,
    acceptance_criteria,
    coding_agent_prompt,
    context_bundle,
    finalized_at,
    user_id
  )
  VALUES (
    v_request_id,
    'finalized',
    'Add an Acme-scoped enterprise approval workflow for deals over $50k before Contract Sent or Closed Won.',
    '1. Use Nia to inspect the CRM pipeline, lead detail, migrations, and RLS patterns.\n2. Add additive approval and feature flag schema only.\n3. Enforce blocked stage transitions in the backend stage-update RPC.\n4. Add a lead-detail approval request and status UI only when the feature flag is enabled.\n5. Run Acme/BetaCorp smoke tests before review.',
    ARRAY[
      'Acme sees the approval workflow for deals over $50k.',
      'BetaCorp keeps the normal CRM behavior with no approval UI.',
      'A high-value Acme deal cannot move to Contract Sent or Closed Won without approved legal review.',
      'Approval request and approval audit events persist.',
      'Approved high-value Acme deal can advance.'
    ],
    'Use Nia to inspect this CRM repo before making changes. Implement enterprise_deal_approvals for Acme only. Prefer additive migrations, preserve existing behavior, enforce the gate in the backend stage-update path, add lead-detail UI, and return exact changed files plus smoke test results.',
    jsonb_build_object(
      'customer', 'Acme',
      'feature_key', 'enterprise_deal_approvals',
      'context_sources', jsonb_build_array('planning_chat', 'change_request', 'Nia repo inspection', 'Hyperspell customer memory')
    ),
    now(),
    p_user_id
  )
  ON CONFLICT (change_request_id) DO UPDATE
  SET status = EXCLUDED.status,
      summary = EXCLUDED.summary,
      implementation_plan = EXCLUDED.implementation_plan,
      acceptance_criteria = EXCLUDED.acceptance_criteria,
      coding_agent_prompt = EXCLUDED.coding_agent_prompt,
      context_bundle = EXCLUDED.context_bundle,
      finalized_at = EXCLUDED.finalized_at,
      updated_at = now()
  RETURNING id INTO v_plan_id;

  UPDATE public.agent_runs
  SET plan_id = v_plan_id,
      plan_snapshot = jsonb_build_object(
        'summary', (SELECT summary FROM public.change_request_plans WHERE id = v_plan_id),
        'acceptance_criteria', (SELECT to_jsonb(acceptance_criteria) FROM public.change_request_plans WHERE id = v_plan_id)
      )
  WHERE change_request_id = v_request_id
    AND user_id = p_user_id
    AND plan_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_forkable_planning_demo(uuid) TO authenticated;

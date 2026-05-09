ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deal_value numeric(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS leads_user_deal_value_idx
  ON public.leads (user_id, deal_value);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  feature_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.customer_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email text NOT NULL,
  feature_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_email, feature_key, user_id)
);

CREATE TABLE IF NOT EXISTS public.change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'planning', 'building', 'review', 'approved', 'rejected', 'merged')),
  feature_key text REFERENCES public.feature_flags(key),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id uuid NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'passed', 'failed', 'approved', 'merged')),
  git_branch text,
  backend_branch text,
  preview_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  order_index integer NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped')),
  details text,
  completed_at timestamptz,
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.branch_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  app_url text NOT NULL,
  backend_branch text,
  deployment_id text,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('building', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  details text,
  completed_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by uuid NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.deal_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  amount numeric(12,2),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  user_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS public.deal_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid NOT NULL REFERENCES public.deal_approval_requests(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  assigned_to uuid,
  completed_by uuid,
  completed_at timestamptz,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.deal_approval_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid REFERENCES public.deal_approval_requests(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feature_flags_user_idx
  ON public.user_feature_flags (user_id, feature_key);
CREATE INDEX IF NOT EXISTS change_requests_user_idx
  ON public.change_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_request_idx
  ON public.agent_runs (change_request_id);
CREATE INDEX IF NOT EXISTS agent_steps_run_idx
  ON public.agent_steps (run_id, order_index);
CREATE INDEX IF NOT EXISTS deal_approval_requests_lead_idx
  ON public.deal_approval_requests (lead_id, status);
CREATE INDEX IF NOT EXISTS deal_approval_requests_user_idx
  ON public.deal_approval_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_approval_audit_lead_idx
  ON public.deal_approval_audit_events (lead_id, created_at DESC);

INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'enterprise_deal_approvals',
  'Enterprise deal approvals',
  'Require legal approval before enterprise deals can move to Contract Sent or Closed Won.'
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.has_feature_flag(p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_feature_flags uff
      WHERE uff.user_id = auth.uid()
        AND uff.feature_key = p_feature_key
        AND uff.enabled = true
    )
    OR (
      p_feature_key = 'enterprise_deal_approvals'
      AND lower(coalesce(auth.email(), '')) = 'acme@forkable.site'
    );
$$;

CREATE OR REPLACE FUNCTION public.has_approved_legal_review(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deal_approval_requests dar
    WHERE dar.lead_id = p_lead_id
      AND dar.user_id = auth.uid()
      AND dar.status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.request_deal_approval(
  p_lead_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_request_id uuid;
  v_amount numeric(12,2);
BEGIN
  SELECT deal_value INTO v_amount
  FROM public.leads
  WHERE id = p_lead_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found.';
  END IF;

  SELECT id INTO v_request_id
  FROM public.deal_approval_requests
  WHERE lead_id = p_lead_id
    AND user_id = auth.uid()
    AND status IN ('pending', 'approved')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    RETURN v_request_id;
  END IF;

  INSERT INTO public.deal_approval_requests (
    lead_id,
    requested_by,
    amount,
    reason,
    user_id
  )
  VALUES (
    p_lead_id,
    auth.uid(),
    v_amount,
    p_reason,
    auth.uid()
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.deal_approval_steps (
    approval_request_id,
    name,
    user_id
  )
  VALUES (
    v_request_id,
    'Legal Review',
    auth.uid()
  );

  INSERT INTO public.deal_approval_audit_events (
    approval_request_id,
    lead_id,
    event_type,
    actor_id,
    metadata,
    user_id
  )
  VALUES (
    v_request_id,
    p_lead_id,
    'approval_requested',
    auth.uid(),
    jsonb_build_object('amount', v_amount, 'reason', p_reason),
    auth.uid()
  );

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_deal_approval(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  UPDATE public.deal_approval_requests
  SET status = 'approved',
      approved_at = now()
  WHERE id = p_request_id
    AND user_id = auth.uid()
  RETURNING lead_id INTO v_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request not found.';
  END IF;

  UPDATE public.deal_approval_steps
  SET status = 'approved',
      completed_by = auth.uid(),
      completed_at = now()
  WHERE approval_request_id = p_request_id
    AND user_id = auth.uid();

  INSERT INTO public.deal_approval_audit_events (
    approval_request_id,
    lead_id,
    event_type,
    actor_id,
    user_id
  )
  VALUES (
    p_request_id,
    v_lead_id,
    'approval_approved',
    auth.uid(),
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_lead_stage(
  p_lead_id uuid,
  p_to_stage_id uuid,
  p_user_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_stage_id uuid;
  v_last_changed_at timestamptz;
  v_time_in_stage interval;
  v_deal_value numeric(12,2);
  v_to_stage_name text;
BEGIN
  SELECT current_stage_id, deal_value
    INTO v_from_stage_id, v_deal_value
  FROM public.leads
  WHERE id = p_lead_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found.';
  END IF;

  SELECT lower(name)
    INTO v_to_stage_name
  FROM public.lead_stages
  WHERE id = p_to_stage_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage not found.';
  END IF;

  IF public.has_feature_flag('enterprise_deal_approvals')
    AND v_deal_value >= 50000
    AND v_to_stage_name IN ('contract sent', 'closed won')
    AND NOT public.has_approved_legal_review(p_lead_id)
  THEN
    RAISE EXCEPTION 'Legal Review required before this deal can advance.';
  END IF;

  IF v_from_stage_id IS NOT NULL THEN
    SELECT changed_at INTO v_last_changed_at
    FROM public.lead_stage_history
    WHERE lead_id = p_lead_id
    ORDER BY changed_at DESC
    LIMIT 1;

    IF v_last_changed_at IS NOT NULL THEN
      v_time_in_stage := now() - v_last_changed_at;
    END IF;
  END IF;

  INSERT INTO public.lead_stage_history (
    lead_id, from_stage_id, to_stage_id, changed_by, time_in_previous_stage, notes, user_id
  ) VALUES (
    p_lead_id, v_from_stage_id, p_to_stage_id, p_user_id, v_time_in_stage, p_notes, p_user_id
  );

  UPDATE public.leads
  SET current_stage_id = p_to_stage_id,
      updated_at = now()
  WHERE id = p_lead_id
    AND user_id = p_user_id;

  INSERT INTO public.deal_approval_audit_events (
    lead_id,
    event_type,
    actor_id,
    metadata,
    user_id
  )
  VALUES (
    p_lead_id,
    'stage_changed',
    p_user_id,
    jsonb_build_object('to_stage', v_to_stage_name, 'deal_value', v_deal_value),
    p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_forkable_demo(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_request_id uuid;
  v_run_id uuid;
BEGIN
  INSERT INTO public.customer_feature_flags (
    customer_email,
    feature_key,
    enabled,
    user_id
  )
  VALUES
    ('acme@forkable.site', 'enterprise_deal_approvals', true, p_user_id),
    ('betacorp@forkable.site', 'enterprise_deal_approvals', false, p_user_id)
  ON CONFLICT (customer_email, feature_key, user_id)
  DO UPDATE SET enabled = EXCLUDED.enabled;

  INSERT INTO public.change_requests (
    title,
    customer_name,
    customer_email,
    description,
    status,
    feature_key,
    user_id
  )
  VALUES (
    'Enterprise Deal Approval Gate',
    'Acme',
    'acme@forkable.site',
    'Any deal over $50k must go through Legal Review before it can move to Contract Sent or Closed Won.',
    'review',
    'enterprise_deal_approvals',
    p_user_id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT id INTO v_request_id
    FROM public.change_requests
    WHERE user_id = p_user_id
      AND feature_key = 'enterprise_deal_approvals'
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.agent_runs (
    change_request_id,
    status,
    git_branch,
    backend_branch,
    preview_url,
    finished_at,
    user_id
  )
  VALUES (
    v_request_id,
    'passed',
    'feat/acme-approval-gate',
    'acme-approval-gate',
    'https://preview.forkable.site/acme-approval-gate',
    now(),
    p_user_id
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.agent_steps (run_id, order_index, label, status, completed_at, user_id)
  VALUES
    (v_run_id, 1, 'Nia indexed CRM repo', 'passed', now(), p_user_id),
    (v_run_id, 2, 'Found lead pipeline components', 'passed', now(), p_user_id),
    (v_run_id, 3, 'Created Git branch feat/acme-approval-gate', 'passed', now(), p_user_id),
    (v_run_id, 4, 'Created InsForge backend branch acme-approval-gate', 'passed', now(), p_user_id),
    (v_run_id, 5, 'Added approval tables and RLS policies', 'passed', now(), p_user_id),
    (v_run_id, 6, 'Added backend enforcement', 'passed', now(), p_user_id),
    (v_run_id, 7, 'Deployed preview', 'passed', now(), p_user_id),
    (v_run_id, 8, 'Ran smoke tests: 8/8 passed', 'passed', now(), p_user_id);

  INSERT INTO public.branch_previews (
    run_id,
    app_url,
    backend_branch,
    deployment_id,
    status,
    user_id
  )
  VALUES (
    v_run_id,
    'https://preview.forkable.site/acme-approval-gate',
    'acme-approval-gate',
    'demo-preview',
    'ready',
    p_user_id
  );

  INSERT INTO public.test_results (run_id, name, status, details, user_id)
  VALUES
    (v_run_id, 'Base app loads', 'passed', 'CRM dashboard rendered.', p_user_id),
    (v_run_id, 'Acme login works', 'passed', 'Authenticated as acme@forkable.site.', p_user_id),
    (v_run_id, 'BetaCorp login works', 'passed', 'Authenticated as betacorp@forkable.site.', p_user_id),
    (v_run_id, 'Acme sees approval feature', 'passed', 'Feature flag resolved true.', p_user_id),
    (v_run_id, 'BetaCorp does not see approval feature', 'passed', 'Feature flag resolved false.', p_user_id),
    (v_run_id, 'Acme deal over $50k is blocked without approval', 'passed', 'Database RPC raised Legal Review required.', p_user_id),
    (v_run_id, 'Approval request can be created', 'passed', 'Approval persisted in deal_approval_requests.', p_user_id),
    (v_run_id, 'Approved deal can advance', 'passed', 'Stage update succeeds after approval.', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_crm_defaults(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id uuid;
  v_stage_new uuid;
  v_stage_proposal uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_sources WHERE user_id = p_user_id) THEN
    INSERT INTO public.lead_sources (name, user_id) VALUES
      ('Website', p_user_id),
      ('Referral', p_user_id),
      ('Social Media', p_user_id),
      ('Cold Call', p_user_id),
      ('Email Campaign', p_user_id),
      ('Trade Show', p_user_id),
      ('Other', p_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.lead_stages WHERE user_id = p_user_id) THEN
    INSERT INTO public.lead_stages (name, order_index, user_id) VALUES
      ('New Lead', 1, p_user_id),
      ('Contacted', 2, p_user_id),
      ('Qualified', 3, p_user_id),
      ('Proposal', 4, p_user_id),
      ('Contract Sent', 5, p_user_id),
      ('Closed Won', 6, p_user_id),
      ('Lost', 7, p_user_id);
  END IF;

  SELECT id INTO v_source_id
  FROM public.lead_sources
  WHERE user_id = p_user_id
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT id INTO v_stage_new
  FROM public.lead_stages
  WHERE user_id = p_user_id
  ORDER BY order_index ASC
  LIMIT 1;

  SELECT id INTO v_stage_proposal
  FROM public.lead_stages
  WHERE user_id = p_user_id
    AND lower(name) = 'proposal'
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE user_id = p_user_id
      AND company_name = 'Northstar Expansion'
  ) THEN
    INSERT INTO public.leads (
      company_name,
      industry,
      contact_name,
      contact_title,
      contact_email,
      source_id,
      current_stage_id,
      status,
      score,
      notes,
      deal_value,
      user_id
    )
    VALUES (
      'Northstar Expansion',
      'Enterprise Software',
      'Nina Patel',
      'VP Operations',
      'nia.patel@acme.example',
      v_source_id,
      coalesce(v_stage_proposal, v_stage_new),
      'qualified',
      91,
      'Acme requested Legal Review before enterprise deals move to Contract Sent or Closed Won.',
      120000,
      p_user_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE user_id = p_user_id
      AND company_name = 'BetaCorp Pilot'
  ) THEN
    INSERT INTO public.leads (
      company_name,
      industry,
      contact_name,
      contact_title,
      contact_email,
      source_id,
      current_stage_id,
      status,
      score,
      notes,
      deal_value,
      user_id
    )
    VALUES (
      'BetaCorp Pilot',
      'Fintech',
      'Marco Chen',
      'Head of Product',
      'marco@betacorp.example',
      v_source_id,
      v_stage_new,
      'contacted',
      64,
      'Control customer for the feature-flag proof.',
      42000,
      p_user_id
    );
  END IF;

  PERFORM public.seed_forkable_demo(p_user_id);
END;
$$;

GRANT SELECT ON TABLE public.feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_feature_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.change_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.branch_previews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.test_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.review_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deal_approval_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deal_approval_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.deal_approval_audit_events TO authenticated;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_approval_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_feature_flags"
  ON public.feature_flags FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "auth_user_own_user_feature_flags"
  ON public.user_feature_flags FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_customer_feature_flags"
  ON public.customer_feature_flags FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_change_requests"
  ON public.change_requests FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_agent_runs"
  ON public.agent_runs FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_agent_steps"
  ON public.agent_steps FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_branch_previews"
  ON public.branch_previews FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_test_results"
  ON public.test_results FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_review_decisions"
  ON public.review_decisions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_deal_approval_requests"
  ON public.deal_approval_requests FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_deal_approval_steps"
  ON public.deal_approval_steps FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "auth_user_own_deal_approval_audit_events"
  ON public.deal_approval_audit_events FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS company_account_id uuid;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_account_id uuid;

ALTER TABLE public.change_requests
  ADD COLUMN IF NOT EXISTS company_account_id uuid;

CREATE TABLE IF NOT EXISTS public.company_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  domain text,
  website text,
  industry text,
  segment text,
  address text,
  postal_code text,
  country_code text,
  notes text,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT company_accounts_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT company_accounts_user_slug_unique UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS public.company_account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_account_id uuid NOT NULL REFERENCES public.company_accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  title text,
  account_role text NOT NULL DEFAULT 'Member',
  is_demo_login boolean NOT NULL DEFAULT false,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_account_members_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT company_account_members_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT company_account_members_user_email_unique UNIQUE (user_id, email)
);

CREATE TABLE IF NOT EXISTS public.company_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_account_id uuid NOT NULL REFERENCES public.company_accounts(id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  rollout_stage text NOT NULL DEFAULT 'disabled',
  notes text,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_feature_flags_unique UNIQUE (company_account_id, feature_key, user_id)
);

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_company_account_id_fkey,
  ADD CONSTRAINT leads_company_account_id_fkey
    FOREIGN KEY (company_account_id) REFERENCES public.company_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_company_account_id_fkey,
  ADD CONSTRAINT clients_company_account_id_fkey
    FOREIGN KEY (company_account_id) REFERENCES public.company_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.change_requests
  DROP CONSTRAINT IF EXISTS change_requests_company_account_id_fkey,
  ADD CONSTRAINT change_requests_company_account_id_fkey
    FOREIGN KEY (company_account_id) REFERENCES public.company_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.customer_feature_flags
  ADD COLUMN IF NOT EXISTS company_account_id uuid;

ALTER TABLE public.customer_feature_flags
  DROP CONSTRAINT IF EXISTS customer_feature_flags_company_account_id_fkey,
  ADD CONSTRAINT customer_feature_flags_company_account_id_fkey
    FOREIGN KEY (company_account_id) REFERENCES public.company_accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS company_accounts_user_idx
  ON public.company_accounts (user_id, name);
CREATE INDEX IF NOT EXISTS company_account_members_company_idx
  ON public.company_account_members (company_account_id);
CREATE INDEX IF NOT EXISTS company_account_members_email_idx
  ON public.company_account_members (user_id, lower(email));
CREATE INDEX IF NOT EXISTS company_feature_flags_company_idx
  ON public.company_feature_flags (company_account_id, feature_key, enabled);
CREATE INDEX IF NOT EXISTS leads_company_account_idx
  ON public.leads (user_id, company_account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_account_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_feature_flags TO authenticated;

ALTER TABLE public.company_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_account_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_company_accounts"
  ON public.company_accounts;
CREATE POLICY "auth_user_own_company_accounts"
  ON public.company_accounts FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auth_user_own_company_account_members"
  ON public.company_account_members;
CREATE POLICY "auth_user_own_company_account_members"
  ON public.company_account_members FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auth_user_own_company_feature_flags"
  ON public.company_feature_flags;
CREATE POLICY "auth_user_own_company_feature_flags"
  ON public.company_feature_flags FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.has_company_feature_flag(
  p_feature_key text,
  p_user_email text DEFAULT auth.email(),
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_account_members member
    JOIN public.company_feature_flags flag
      ON flag.company_account_id = member.company_account_id
     AND flag.user_id = p_user_id
     AND flag.feature_key = p_feature_key
     AND flag.enabled = true
    WHERE member.user_id = p_user_id
      AND lower(member.email) = lower(coalesce(p_user_email, ''))
  );
$$;

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
    OR public.has_company_feature_flag(p_feature_key, auth.email(), auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.customer_feature_flags flag
      WHERE flag.user_id = auth.uid()
        AND lower(flag.customer_email) = lower(coalesce(auth.email(), ''))
        AND flag.feature_key = p_feature_key
        AND flag.enabled = true
    );
$$;

CREATE OR REPLACE FUNCTION public.lead_has_feature_flag(
  p_lead_id uuid,
  p_feature_key text,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH target_lead AS (
    SELECT id, company_account_id, company_name, contact_email
    FROM public.leads
    WHERE id = p_lead_id
      AND user_id = p_user_id
    LIMIT 1
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM target_lead lead
      JOIN public.company_feature_flags flag
        ON flag.company_account_id = lead.company_account_id
       AND flag.user_id = p_user_id
       AND flag.feature_key = p_feature_key
       AND flag.enabled = true
    )
    OR EXISTS (
      SELECT 1
      FROM target_lead lead
      JOIN public.customer_feature_flags flag
        ON flag.user_id = p_user_id
       AND flag.feature_key = p_feature_key
       AND flag.enabled = true
      LEFT JOIN public.change_requests request
        ON request.user_id = flag.user_id
       AND request.customer_email = flag.customer_email
       AND (request.feature_key = flag.feature_key OR request.feature_key IS NULL)
      WHERE (
          flag.company_account_id IS NOT NULL
          AND lead.company_account_id = flag.company_account_id
        )
        OR lower(coalesce(lead.contact_email, '')) = lower(flag.customer_email)
        OR (
          request.company_account_id IS NOT NULL
          AND lead.company_account_id = request.company_account_id
        )
        OR (
          request.customer_name IS NOT NULL
          AND lower(lead.company_name) LIKE lower(request.customer_name) || '%'
        )
    );
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

  IF public.lead_has_feature_flag(p_lead_id, 'enterprise_deal_approvals', p_user_id)
    AND v_deal_value >= 50000
    AND v_to_stage_name IN ('contract sent', 'closed won')
    AND NOT public.has_approved_legal_review(p_lead_id, p_user_id)
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_run_id uuid;
  v_plan_id uuid;
BEGIN
  INSERT INTO public.feature_flags (key, name, description)
  VALUES
    (
      'enterprise_deal_approvals',
      'Enterprise deal approvals',
      'Require legal approval before enterprise deals can move to Contract Sent or Closed Won.'
    ),
    (
      'regional_pipeline_views',
      'Regional pipeline views',
      'Show company-specific regional pipeline filters and forecast summaries.'
    ),
    (
      'implementation_risk_scoring',
      'Implementation risk scoring',
      'Score open opportunities for launch complexity, compliance risk, and stakeholder readiness.'
    ),
    (
      'security_questionnaire_workspace',
      'Security questionnaire workspace',
      'Give security and legal teams a structured workspace for questionnaire review.'
    )
  ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description;

  DELETE FROM public.change_requests
  WHERE user_id = p_user_id
    AND (
      customer_email IN ('acme@forkable.site', 'betacorp@forkable.site')
      OR customer_name IN ('Acme', 'BetaCorp')
    );

  WITH seeded_flags AS (
    SELECT *
    FROM (
      VALUES
        ('shopify', 'enterprise_deal_approvals', true, 'preview', 'Shopify needs legal approval evidence before late-stage movement.'),
        ('shopify', 'implementation_risk_scoring', true, 'enabled', 'Risk score is visible on strategic opportunities.'),
        ('stripe', 'enterprise_deal_approvals', false, 'disabled', 'Stripe remains on the standard CRM flow for approval gating.'),
        ('stripe', 'regional_pipeline_views', true, 'planning', 'Stripe is validating regional forecast filters.'),
        ('datadog', 'implementation_risk_scoring', true, 'enabled', 'Launch risk score informs the enterprise expansion forecast.'),
        ('figma', 'enterprise_deal_approvals', false, 'disabled', 'Figma is the clean control account for the approval workflow.'),
        ('snowflake', 'enterprise_deal_approvals', true, 'enabled', 'Large data-cloud expansion deals require legal approval.'),
        ('cloudflare', 'security_questionnaire_workspace', true, 'requested', 'Cloudflare wants questionnaire ownership and audit history.'),
        ('plaid', 'regional_pipeline_views', true, 'enabled', 'Regional forecast views are enabled for account planning.'),
        ('instacart', 'regional_pipeline_views', true, 'planning', 'Instacart is piloting market-level pipeline rollups.'),
        ('atlassian', 'enterprise_deal_approvals', true, 'preview', 'Atlassian is testing the approval gate.'),
        ('hubspot', 'enterprise_deal_approvals', false, 'disabled', 'HubSpot remains a standard-product control account.'),
        ('canva', 'implementation_risk_scoring', true, 'enabled', 'Canva uses risk scoring to time expansion workshops.'),
        ('ramp', 'security_questionnaire_workspace', true, 'planning', 'Ramp packet review is being structured for finance buyers.')
    ) AS flags(company_slug, feature_key, enabled, rollout_stage, notes)
  ), resolved AS (
    SELECT
      accounts.id AS company_account_id,
      seeded_flags.feature_key,
      seeded_flags.enabled,
      seeded_flags.rollout_stage,
      seeded_flags.notes
    FROM seeded_flags
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = seeded_flags.company_slug
  )
  INSERT INTO public.company_feature_flags (
    company_account_id,
    feature_key,
    enabled,
    rollout_stage,
    notes,
    user_id
  )
  SELECT
    company_account_id,
    feature_key,
    enabled,
    rollout_stage,
    notes,
    p_user_id
  FROM resolved
  ON CONFLICT (company_account_id, feature_key, user_id)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    rollout_stage = EXCLUDED.rollout_stage,
    notes = EXCLUDED.notes,
    updated_at = now();

  WITH company_emails AS (
    SELECT *
    FROM (
      VALUES
        ('shopify', 'shopify@forkable.site'),
        ('stripe', 'stripe@forkable.site'),
        ('datadog', 'datadog@forkable.site'),
        ('figma', 'figma@forkable.site'),
        ('snowflake', 'snowflake@forkable.site'),
        ('cloudflare', 'cloudflare@forkable.site'),
        ('plaid', 'plaid@forkable.site'),
        ('instacart', 'instacart@forkable.site'),
        ('atlassian', 'atlassian@forkable.site'),
        ('hubspot', 'hubspot@forkable.site'),
        ('canva', 'canva@forkable.site'),
        ('ramp', 'ramp@forkable.site')
    ) AS emails(company_slug, customer_email)
  ), enabled_flags AS (
    SELECT
      emails.customer_email,
      flags.company_account_id,
      flags.feature_key,
      flags.enabled
    FROM company_emails emails
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = emails.company_slug
    JOIN public.company_feature_flags flags
      ON flags.company_account_id = accounts.id
     AND flags.user_id = p_user_id
  )
  INSERT INTO public.customer_feature_flags (
    customer_email,
    company_account_id,
    feature_key,
    enabled,
    user_id
  )
  SELECT
    customer_email,
    company_account_id,
    feature_key,
    enabled,
    p_user_id
  FROM enabled_flags
  ON CONFLICT (customer_email, feature_key, user_id)
  DO UPDATE SET
    company_account_id = EXCLUDED.company_account_id,
    enabled = EXCLUDED.enabled;

  WITH seeded_requests AS (
    SELECT *
    FROM (
      VALUES
        (
          'shopify',
          'Enterprise Deal Approval Gate',
          'shopify@forkable.site',
          'Require Legal Review approval before Shopify Enterprise Sales deals over $50k move to Contract Sent or Closed Won.',
          'review',
          'enterprise_deal_approvals'
        ),
        (
          'stripe',
          'Regional Pipeline Forecast Views',
          'stripe@forkable.site',
          'Give Stripe Revenue Operations North America, EMEA, and APAC pipeline views without changing the standard selling workflow.',
          'planning',
          'regional_pipeline_views'
        ),
        (
          'datadog',
          'Implementation Risk Score',
          'datadog@forkable.site',
          'Score enterprise expansion deals using integration count, security review status, and executive sponsor coverage.',
          'building',
          'implementation_risk_scoring'
        ),
        (
          'cloudflare',
          'Security Questionnaire Workspace',
          'cloudflare@forkable.site',
          'Route security questionnaires through a structured review workspace with owners, due dates, and audit events.',
          'requested',
          'security_questionnaire_workspace'
        ),
        (
          'figma',
          'Mutual Action Plan Templates',
          'figma@forkable.site',
          'Create reusable mutual action plan templates for design-platform enterprise rollouts.',
          'requested',
          NULL
        )
    ) AS requests(company_slug, title, customer_email, description, status, feature_key)
  ), resolved AS (
    SELECT
      requests.title,
      accounts.name AS customer_name,
      requests.customer_email,
      requests.description,
      requests.status,
      requests.feature_key,
      accounts.id AS company_account_id
    FROM seeded_requests requests
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = requests.company_slug
  )
  INSERT INTO public.change_requests (
    title,
    customer_name,
    customer_email,
    description,
    status,
    feature_key,
    company_account_id,
    user_id
  )
  SELECT
    title,
    customer_name,
    customer_email,
    description,
    status,
    feature_key,
    company_account_id,
    p_user_id
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.change_requests existing
    WHERE existing.user_id = p_user_id
      AND existing.customer_email = resolved.customer_email
      AND existing.title = resolved.title
  );

  SELECT id INTO v_request_id
  FROM public.change_requests
  WHERE user_id = p_user_id
    AND customer_email = 'shopify@forkable.site'
    AND title = 'Enterprise Deal Approval Gate'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    SELECT id INTO v_run_id
    FROM public.agent_runs
    WHERE change_request_id = v_request_id
      AND user_id = p_user_id
      AND git_branch = 'feat/shopify-approval-gate'
    ORDER BY started_at ASC
    LIMIT 1;

    IF v_run_id IS NULL THEN
      INSERT INTO public.agent_runs (
        change_request_id,
        status,
        git_branch,
        backend_branch,
        preview_url,
        finished_at,
        output_summary,
        pull_request_url,
        commit_sha,
        user_id
      )
      VALUES (
        v_request_id,
        'passed',
        'feat/shopify-approval-gate',
        'shopify-approval-gate',
        'https://preview.forkable.site/shopify-approval-gate',
        now() - interval '1 day',
        'Added company feature flags, approval persistence, backend enforcement, lead-detail approval actions, and Shopify/Stripe smoke coverage.',
        'https://github.com/forkable/demo/pull/58',
        '9c2f7ba',
        p_user_id
      )
      RETURNING id INTO v_run_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.agent_steps WHERE run_id = v_run_id AND user_id = p_user_id
    ) THEN
      INSERT INTO public.agent_steps (run_id, order_index, label, status, details, completed_at, user_id)
      VALUES
        (v_run_id, 1, 'Indexed CRM repo and seed migrations', 'passed', 'Found lead pipeline, approval RPCs, company accounts, and feature flag tables.', now() - interval '1 day 4 hours', p_user_id),
        (v_run_id, 2, 'Created Git branch feat/shopify-approval-gate', 'passed', 'Prepared additive schema changes for company rollout.', now() - interval '1 day 3 hours 40 minutes', p_user_id),
        (v_run_id, 3, 'Created InsForge backend branch shopify-approval-gate', 'passed', 'Validated branch data against Shopify and Stripe demo accounts.', now() - interval '1 day 3 hours 20 minutes', p_user_id),
        (v_run_id, 4, 'Added approval tables and policies', 'passed', 'Approval request, step, and audit tables remain user-scoped.', now() - interval '1 day 2 hours 55 minutes', p_user_id),
        (v_run_id, 5, 'Enforced blocked stage transitions', 'passed', 'Blocked high-value Shopify deals until Legal Review is approved.', now() - interval '1 day 2 hours 20 minutes', p_user_id),
        (v_run_id, 6, 'Updated lead detail review flow', 'passed', 'Approval UI appears only when the lead company flag is enabled.', now() - interval '1 day 1 hour 50 minutes', p_user_id),
        (v_run_id, 7, 'Deployed preview', 'passed', 'Preview is ready for product review.', now() - interval '1 day 1 hour 20 minutes', p_user_id),
        (v_run_id, 8, 'Ran smoke tests: 8/8 passed', 'passed', 'Verified Shopify-specific behavior and unchanged Stripe behavior.', now() - interval '1 day', p_user_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.branch_previews WHERE run_id = v_run_id AND user_id = p_user_id
    ) THEN
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
        'https://preview.forkable.site/shopify-approval-gate',
        'shopify-approval-gate',
        'demo-preview-shopify-approval',
        'ready',
        p_user_id
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.test_results WHERE run_id = v_run_id AND user_id = p_user_id
    ) THEN
      INSERT INTO public.test_results (run_id, name, status, details, user_id)
      VALUES
        (v_run_id, 'Base app loads', 'passed', 'CRM dashboard rendered with the realistic company demo pipeline.', p_user_id),
        (v_run_id, 'Shopify demo user is assigned', 'passed', 'shopify@forkable.site resolves to the Shopify company account.', p_user_id),
        (v_run_id, 'Stripe demo user is assigned', 'passed', 'stripe@forkable.site resolves to the Stripe company account.', p_user_id),
        (v_run_id, 'Shopify sees approval feature', 'passed', 'Feature flag resolved true for enterprise_deal_approvals.', p_user_id),
        (v_run_id, 'Stripe does not see approval feature', 'passed', 'Feature flag resolved false, preserving the standard CRM flow.', p_user_id),
        (v_run_id, 'Shopify deal over $50k is blocked without approval', 'passed', 'Database RPC raised Legal Review required.', p_user_id),
        (v_run_id, 'Approval request can be created', 'passed', 'Request and audit rows persisted.', p_user_id),
        (v_run_id, 'Approved deal can advance', 'passed', 'Stage update succeeds after approval.', p_user_id);
    END IF;
  END IF;

  SELECT id INTO v_request_id
  FROM public.change_requests
  WHERE user_id = p_user_id
    AND customer_email = 'stripe@forkable.site'
    AND title = 'Regional Pipeline Forecast Views'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_request_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.agent_runs
      WHERE change_request_id = v_request_id
        AND user_id = p_user_id
        AND git_branch = 'feat/stripe-regional-pipeline'
    )
  THEN
    INSERT INTO public.agent_runs (
      change_request_id,
      status,
      git_branch,
      backend_branch,
      preview_url,
      started_at,
      output_summary,
      user_id
    )
    VALUES (
      v_request_id,
      'running',
      'feat/stripe-regional-pipeline',
      'stripe-regional-pipeline',
      'https://preview.forkable.site/stripe-regional-pipeline',
      now() - interval '3 hours',
      'Inspecting regional forecast requirements and pipeline query filters before implementation.',
      p_user_id
    )
    RETURNING id INTO v_run_id;

    INSERT INTO public.agent_steps (run_id, order_index, label, status, details, completed_at, user_id)
    VALUES
      (v_run_id, 1, 'Loaded finalized planning context', 'passed', 'Stripe regional views are scoped to reporting and filtering only.', now() - interval '2 hours 45 minutes', p_user_id),
      (v_run_id, 2, 'Inspected lead and dashboard queries', 'passed', 'Found query surfaces for pipeline, list, and dashboard summaries.', now() - interval '2 hours 15 minutes', p_user_id),
      (v_run_id, 3, 'Drafted additive data model', 'running', 'Evaluating region fields for leads and company account members.', NULL, p_user_id),
      (v_run_id, 4, 'Implement regional filters', 'pending', NULL, NULL, p_user_id),
      (v_run_id, 5, 'Run Stripe smoke tests', 'pending', NULL, NULL, p_user_id);
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
  SELECT
    v_request_id,
    'finalized',
    'Add company-scoped regional pipeline views for Stripe.',
    '1. Inspect lead, dashboard, and pipeline queries.\n2. Add additive region metadata only.\n3. Gate the regional view behind Stripe company flags.\n4. Preserve the standard CRM experience for companies without the flag.\n5. Run Stripe and Shopify smoke tests before review.',
    ARRAY[
      'Stripe sees regional pipeline views.',
      'Companies without the regional_pipeline_views flag keep the standard pipeline.',
      'The regional view groups active opportunities by North America, EMEA, and APAC.',
      'No approval-gate behavior is enabled for Stripe.'
    ],
    'Use Nia to inspect this CRM repo before making changes. Implement regional_pipeline_views for Stripe only. Prefer additive migrations, preserve existing behavior, and return exact changed files plus smoke test results.',
    jsonb_build_object(
      'customer', 'Stripe',
      'feature_key', 'regional_pipeline_views',
      'context_sources', jsonb_build_array('planning_chat', 'change_request', 'company_account_membership')
    ),
    now(),
    p_user_id
  WHERE v_request_id IS NOT NULL
  ON CONFLICT (change_request_id) DO NOTHING
  RETURNING id INTO v_plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_forkable_planning_demo(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_plan_id uuid;
BEGIN
  SELECT id INTO v_request_id
  FROM public.change_requests
  WHERE user_id = p_user_id
    AND customer_email = 'shopify@forkable.site'
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
        'Keep it Shopify only, require backend enforcement, and make sure Stripe keeps the normal CRM behavior.',
        1,
        p_user_id
      ),
      (
        v_request_id,
        'assistant',
        'Understood. The plan should add a Shopify company feature flag, approval persistence, database enforcement for high-value stage moves, a small approval UI on lead detail, and smoke tests that prove Shopify and Stripe diverge only where intended.',
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
    'Add a Shopify approval workflow for deals over $50k before Contract Sent or Closed Won.',
    '1. Use Nia to inspect the CRM pipeline, lead detail, migrations, RLS patterns, and company-account membership model.\n2. Add additive approval and company feature flag schema only.\n3. Enforce blocked stage transitions in the backend stage-update RPC.\n4. Add a lead-detail approval request and status UI only when the lead company flag is enabled.\n5. Run Shopify/Stripe smoke tests before review.',
    ARRAY[
      'Shopify sees the approval workflow for deals over $50k.',
      'Stripe keeps the normal CRM behavior with no approval UI.',
      'A high-value Shopify deal cannot move to Contract Sent or Closed Won without approved legal review.',
      'Approval request and approval audit events persist.',
      'Approved high-value Shopify deal can advance.'
    ],
    'Use Nia to inspect this CRM repo before making changes. Implement enterprise_deal_approvals for Shopify only. Prefer additive migrations, preserve existing behavior, enforce the gate in the backend stage-update path, add lead-detail UI, and return exact changed files plus smoke test results.',
    jsonb_build_object(
      'customer', 'Shopify',
      'feature_key', 'enterprise_deal_approvals',
      'context_sources', jsonb_build_array('planning_chat', 'change_request', 'company_account_membership', 'Nia repo inspection')
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

CREATE OR REPLACE FUNCTION public.seed_crm_defaults(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_companies jsonb := $json$
  [
    {"name":"Shopify","slug":"shopify","domain":"shopify.com","website":"https://www.shopify.com","industry":"Commerce platform","segment":"Enterprise SaaS","client_code":"SHOPIFY","address":"Toronto, ON","postal_code":"M5V 2T6","country_code":"CA","notes":"Commerce platform account piloting enterprise approval controls."},
    {"name":"Stripe","slug":"stripe","domain":"stripe.com","website":"https://stripe.com","industry":"Financial infrastructure","segment":"Enterprise SaaS","client_code":"STRIPE","address":"South San Francisco, CA","postal_code":"94080","country_code":"US","notes":"Control account for standard CRM behavior and regional views."},
    {"name":"Datadog","slug":"datadog","domain":"datadoghq.com","website":"https://www.datadoghq.com","industry":"Cloud observability","segment":"Enterprise SaaS","client_code":"DDOG","address":"New York, NY","postal_code":"10018","country_code":"US","notes":"Expansion account focused on implementation risk scoring."},
    {"name":"Figma","slug":"figma","domain":"figma.com","website":"https://www.figma.com","industry":"Design collaboration","segment":"Enterprise SaaS","client_code":"FIGMA","address":"San Francisco, CA","postal_code":"94105","country_code":"US","notes":"Standard-product control account with action-plan requests."},
    {"name":"Snowflake","slug":"snowflake","domain":"snowflake.com","website":"https://www.snowflake.com","industry":"Data cloud","segment":"Enterprise SaaS","client_code":"SNOW","address":"Bozeman, MT","postal_code":"59715","country_code":"US","notes":"Data-cloud account with legal approval enabled for large deals."},
    {"name":"Cloudflare","slug":"cloudflare","domain":"cloudflare.com","website":"https://www.cloudflare.com","industry":"Security and network services","segment":"Enterprise SaaS","client_code":"CF","address":"San Francisco, CA","postal_code":"94107","country_code":"US","notes":"Security-led account requesting questionnaire workflow."},
    {"name":"Plaid","slug":"plaid","domain":"plaid.com","website":"https://plaid.com","industry":"Financial APIs","segment":"Enterprise SaaS","client_code":"PLAID","address":"San Francisco, CA","postal_code":"94105","country_code":"US","notes":"Fintech API account with regional pipeline views enabled."},
    {"name":"Instacart","slug":"instacart","domain":"instacart.com","website":"https://www.instacart.com","industry":"Marketplace logistics","segment":"Marketplace","client_code":"INSTA","address":"San Francisco, CA","postal_code":"94105","country_code":"US","notes":"Marketplace account piloting regional forecast rollups."},
    {"name":"Atlassian","slug":"atlassian","domain":"atlassian.com","website":"https://www.atlassian.com","industry":"Team collaboration software","segment":"Enterprise SaaS","client_code":"ATLAS","address":"Sydney, NSW","postal_code":"2000","country_code":"AU","notes":"Enterprise Sales team is testing deal approvals."},
    {"name":"HubSpot","slug":"hubspot","domain":"hubspot.com","website":"https://www.hubspot.com","industry":"CRM platform","segment":"Enterprise SaaS","client_code":"HUBSPOT","address":"Cambridge, MA","postal_code":"02141","country_code":"US","notes":"Standard-product account used as a control in demos."},
    {"name":"Canva","slug":"canva","domain":"canva.com","website":"https://www.canva.com","industry":"Visual communication platform","segment":"Enterprise SaaS","client_code":"CANVA","address":"Sydney, NSW","postal_code":"2010","country_code":"AU","notes":"Customer Success account using implementation risk scoring."},
    {"name":"Ramp","slug":"ramp","domain":"ramp.com","website":"https://ramp.com","industry":"Spend management","segment":"Fintech","client_code":"RAMP","address":"New York, NY","postal_code":"10012","country_code":"US","notes":"Finance buyer account preparing security questionnaire workflow."}
  ]
  $json$::jsonb;
  v_leads jsonb := $json$
  [
    {"company_slug":"shopify","company_name":"Shopify","industry":"Commerce platform","website":"https://www.shopify.com","contact_name":"Morgan Lee","contact_title":"VP Enterprise Sales","contact_email":"morgan.lee.shopify@forkable.site","contact_phone":"+1 416 555 0112","source_name":"Executive Intro","stage_name":"Proposal","status":"qualified","score":94,"deal_value":186000,"notes":"Enterprise Sales wants legal approval evidence before late-stage movement. Procurement is aligned if audit history is available in the CRM.","tags":"enterprise-sales,approval-gate","created_days_ago":19,"updated_days_ago":1,"activity_subject":"Approval workflow workshop","activity_detail":"Reviewed Contract Sent gate, approver ownership, and audit evidence expectations.","follow_up":"Send legal-review workflow preview to Morgan and procurement."},
    {"company_slug":"shopify","company_name":"Shopify","industry":"Commerce platform","website":"https://www.shopify.com","contact_name":"Priya Raman","contact_title":"Director of Revenue Operations","contact_email":"priya.raman.shopify@forkable.site","contact_phone":"+1 416 555 0184","source_name":"Product Signup","stage_name":"Security Review","status":"qualified","score":87,"deal_value":94000,"notes":"RevOps is validating field governance, stage auditability, and admin ownership before expanding the rollout beyond Enterprise Sales.","tags":"revops,governance","created_days_ago":13,"updated_days_ago":2,"activity_subject":"RevOps data model review","activity_detail":"Mapped required fields, owner roles, and report dependencies for the pilot.","follow_up":"Confirm field governance sign-off with RevOps."},
    {"company_slug":"shopify","company_name":"Shopify","industry":"Commerce platform","website":"https://www.shopify.com","contact_name":"Caleb Torres","contact_title":"Procurement Lead","contact_email":"caleb.torres.shopify@forkable.site","contact_phone":"+1 416 555 0141","source_name":"Referral","stage_name":"Contract Sent","status":"qualified","score":91,"deal_value":142000,"notes":"Order form is in procurement. Legal approval evidence has been requested for the final internal review packet.","tags":"procurement,contract","created_days_ago":31,"updated_days_ago":4,"activity_subject":"Procurement packet review","activity_detail":"Confirmed order form, vendor packet, and legal evidence requirements.","follow_up":"Attach approved legal-review audit event to the order packet."},
    {"company_slug":"stripe","company_name":"Stripe","industry":"Financial infrastructure","website":"https://stripe.com","contact_name":"Elena Voss","contact_title":"Head of Revenue Systems","contact_email":"elena.voss.stripe@forkable.site","contact_phone":"+1 650 555 0191","source_name":"Website","stage_name":"Qualified","status":"qualified","score":83,"deal_value":128000,"notes":"Revenue Systems wants regional forecast views for quarterly pipeline calls. Approval gating should remain disabled for Stripe.","tags":"revops,regional-views","created_days_ago":21,"updated_days_ago":1,"activity_subject":"Regional forecast discovery","activity_detail":"Documented region taxonomy, forecast owner, and reporting cadence.","follow_up":"Share regional view prototype with Revenue Systems."},
    {"company_slug":"stripe","company_name":"Stripe","industry":"Financial infrastructure","website":"https://stripe.com","contact_name":"Jon Bell","contact_title":"Sales Strategy Manager","contact_email":"jon.bell.stripe@forkable.site","contact_phone":"+1 650 555 0168","source_name":"Partner","stage_name":"Contacted","status":"contacted","score":62,"deal_value":48000,"notes":"Sales Strategy is comparing manual spreadsheet forecasts against CRM-generated regional summaries.","tags":"sales-strategy,forecast","created_days_ago":8,"updated_days_ago":2,"activity_subject":"Forecast workflow call","activity_detail":"Reviewed current spreadsheet handoff and required rollup levels.","follow_up":"Send sample regional forecast export."},
    {"company_slug":"stripe","company_name":"Stripe","industry":"Financial infrastructure","website":"https://stripe.com","contact_name":"Nadia Torres","contact_title":"Finance Business Partner","contact_email":"nadia.torres.stripe@forkable.site","contact_phone":"+1 650 555 0130","source_name":"Email Campaign","stage_name":"Closed Won","status":"qualified","score":89,"deal_value":76000,"notes":"Finance signed off on the initial forecasting workspace. Expansion depends on regional filters landing cleanly.","tags":"finance,closed-won","created_days_ago":74,"updated_days_ago":10,"activity_subject":"Finance closeout","activity_detail":"Confirmed forecasting workspace acceptance and expansion criteria.","follow_up":"Schedule regional forecast expansion planning."},
    {"company_slug":"datadog","company_name":"Datadog","industry":"Cloud observability","website":"https://www.datadoghq.com","contact_name":"Ari Klein","contact_title":"Director of Enterprise Applications","contact_email":"ari.klein.datadog@forkable.site","contact_phone":"+1 212 555 0188","source_name":"Trade Show","stage_name":"Proposal","status":"qualified","score":88,"deal_value":154000,"notes":"Enterprise Apps wants risk scoring based on integration count, security review age, and sponsor coverage before committing to a global rollout.","tags":"enterprise-apps,risk-score","created_days_ago":18,"updated_days_ago":3,"activity_subject":"Risk scoring design session","activity_detail":"Mapped risk factors to integration and security-review milestones.","follow_up":"Send risk-score weighting proposal."},
    {"company_slug":"datadog","company_name":"Datadog","industry":"Cloud observability","website":"https://www.datadoghq.com","contact_name":"Samira Khan","contact_title":"Customer Operations Lead","contact_email":"samira.khan.datadog@forkable.site","contact_phone":"+1 212 555 0152","source_name":"Product Signup","stage_name":"Discovery","status":"contacted","score":66,"deal_value":52000,"notes":"Customer Ops is evaluating whether implementation risk can be surfaced in weekly account reviews.","tags":"customer-ops,discovery","created_days_ago":6,"updated_days_ago":1,"activity_subject":"Account review workflow","activity_detail":"Discussed how CSMs review readiness, blockers, and sponsor gaps.","follow_up":"Confirm weekly review dashboard requirements."},
    {"company_slug":"datadog","company_name":"Datadog","industry":"Cloud observability","website":"https://www.datadoghq.com","contact_name":"Noah Patel","contact_title":"Procurement Manager","contact_email":"noah.patel.datadog@forkable.site","contact_phone":"+1 212 555 0177","source_name":"Referral","stage_name":"Lost","status":"unqualified","score":28,"deal_value":22000,"notes":"Procurement paused this smaller request until the enterprise applications team finishes vendor consolidation.","tags":"procurement,paused","created_days_ago":49,"updated_days_ago":17,"activity_subject":"Procurement pause","activity_detail":"Confirmed no action until the vendor consolidation review completes.","follow_up":"Revisit after vendor consolidation checkpoint."},
    {"company_slug":"figma","company_name":"Figma","industry":"Design collaboration","website":"https://www.figma.com","contact_name":"Maya Chen","contact_title":"Design Operations Manager","contact_email":"maya.chen.figma@forkable.site","contact_phone":"+1 415 555 0134","source_name":"Website","stage_name":"Qualified","status":"qualified","score":79,"deal_value":68000,"notes":"Design Ops wants mutual action plan templates for enterprise design-platform rollouts. Approval gating should remain hidden for this control account.","tags":"design-ops,action-plan","created_days_ago":15,"updated_days_ago":2,"activity_subject":"Mutual action plan discovery","activity_detail":"Reviewed launch milestones, stakeholder ownership, and template requirements.","follow_up":"Draft mutual action plan template for design rollouts."},
    {"company_slug":"figma","company_name":"Figma","industry":"Design collaboration","website":"https://www.figma.com","contact_name":"Luca Moretti","contact_title":"Enterprise Success Director","contact_email":"luca.moretti.figma@forkable.site","contact_phone":"+1 415 555 0189","source_name":"Partner","stage_name":"Proposal","status":"qualified","score":84,"deal_value":112000,"notes":"Enterprise Success is aligning template rollout with strategic account planning and renewal-risk reviews.","tags":"customer-success,templates","created_days_ago":26,"updated_days_ago":4,"activity_subject":"Template rollout proposal","activity_detail":"Reviewed adoption milestones and customer-facing plan formats.","follow_up":"Send template pilot scope to Enterprise Success."},
    {"company_slug":"figma","company_name":"Figma","industry":"Design collaboration","website":"https://www.figma.com","contact_name":"Olivia Marsh","contact_title":"Business Operations Analyst","contact_email":"olivia.marsh.figma@forkable.site","contact_phone":"+1 415 555 0165","source_name":"Email Campaign","stage_name":"Closed Won","status":"qualified","score":86,"deal_value":54000,"notes":"Initial reporting workspace closed. Business Operations is measuring template adoption before expansion.","tags":"bizops,closed-won","created_days_ago":83,"updated_days_ago":9,"activity_subject":"Reporting workspace closeout","activity_detail":"Confirmed acceptance metrics and expansion dependencies.","follow_up":"Review template adoption metrics with Business Operations."},
    {"company_slug":"snowflake","company_name":"Snowflake","industry":"Data cloud","website":"https://www.snowflake.com","contact_name":"Leah Watanabe","contact_title":"VP Sales Operations","contact_email":"leah.watanabe.snowflake@forkable.site","contact_phone":"+1 406 555 0144","source_name":"Executive Intro","stage_name":"Security Review","status":"qualified","score":92,"deal_value":215000,"notes":"Sales Operations wants enterprise approval gates and approval evidence exports for data-cloud expansion deals.","tags":"sales-ops,approval-evidence","created_days_ago":24,"updated_days_ago":1,"activity_subject":"Approval evidence review","activity_detail":"Confirmed approval gate scope and export expectations for large deals.","follow_up":"Request legal-review approval for the expansion opportunity."},
    {"company_slug":"snowflake","company_name":"Snowflake","industry":"Data cloud","website":"https://www.snowflake.com","contact_name":"Owen Brooks","contact_title":"Legal Operations Lead","contact_email":"owen.brooks.snowflake@forkable.site","contact_phone":"+1 406 555 0194","source_name":"Referral","stage_name":"Contract Sent","status":"qualified","score":89,"deal_value":164000,"notes":"Legal Operations needs consistent approval records attached to every large contract packet before final review.","tags":"legal-ops,contract","created_days_ago":39,"updated_days_ago":5,"activity_subject":"Contract evidence check","activity_detail":"Reviewed legal-review audit events and evidence export requirements.","follow_up":"Attach approved legal evidence to the contract packet."},
    {"company_slug":"snowflake","company_name":"Snowflake","industry":"Data cloud","website":"https://www.snowflake.com","contact_name":"Tessa Nguyen","contact_title":"Field Enablement Manager","contact_email":"tessa.nguyen.snowflake@forkable.site","contact_phone":"+1 406 555 0171","source_name":"Webinar","stage_name":"New Lead","status":"new","score":53,"deal_value":38000,"notes":"Field Enablement is interested in approval training materials, but this smaller opportunity is below the approval threshold.","tags":"enablement,new","created_days_ago":4,"updated_days_ago":1,"activity_subject":"Enablement intake","activity_detail":"Captured training needs and pilot timing constraints.","follow_up":"Send approval workflow training outline."},
    {"company_slug":"cloudflare","company_name":"Cloudflare","industry":"Security and network services","website":"https://www.cloudflare.com","contact_name":"Rina Kapoor","contact_title":"Security Governance Director","contact_email":"rina.kapoor.cloudflare@forkable.site","contact_phone":"+1 415 555 0198","source_name":"Trade Show","stage_name":"Discovery","status":"contacted","score":73,"deal_value":88000,"notes":"Security wants owner assignment, due dates, and audit events for questionnaire workflows. No deal approval gate is enabled for this account.","tags":"security,questionnaire","created_days_ago":10,"updated_days_ago":1,"activity_subject":"Questionnaire workflow discovery","activity_detail":"Mapped questionnaire intake, reviewer handoffs, and evidence retention needs.","follow_up":"Send questionnaire workspace workflow map."},
    {"company_slug":"cloudflare","company_name":"Cloudflare","industry":"Security and network services","website":"https://www.cloudflare.com","contact_name":"Miles Grant","contact_title":"Enterprise Account Director","contact_email":"miles.grant.cloudflare@forkable.site","contact_phone":"+1 415 555 0122","source_name":"Partner","stage_name":"Qualified","status":"qualified","score":78,"deal_value":105000,"notes":"Enterprise Sales is coordinating with Security but should not see the approval-gate UI in this demo.","tags":"enterprise-sales,control","created_days_ago":17,"updated_days_ago":2,"activity_subject":"Enterprise sales alignment","activity_detail":"Aligned buyer stakeholders and security questionnaire timing.","follow_up":"Confirm Security reviewer availability."},
    {"company_slug":"cloudflare","company_name":"Cloudflare","industry":"Security and network services","website":"https://www.cloudflare.com","contact_name":"Hannah Price","contact_title":"Vendor Risk Manager","contact_email":"hannah.price.cloudflare@forkable.site","contact_phone":"+1 415 555 0159","source_name":"Email Campaign","stage_name":"Proposal","status":"qualified","score":81,"deal_value":97000,"notes":"Vendor Risk is reviewing whether questionnaire artifacts can be exported for internal governance reviews.","tags":"vendor-risk,proposal","created_days_ago":27,"updated_days_ago":6,"activity_subject":"Vendor risk proposal","activity_detail":"Reviewed questionnaire ownership and exportable evidence needs.","follow_up":"Send export sample for vendor-risk review."},
    {"company_slug":"plaid","company_name":"Plaid","industry":"Financial APIs","website":"https://plaid.com","contact_name":"Daniel Reyes","contact_title":"Revenue Operations Director","contact_email":"daniel.reyes.plaid@forkable.site","contact_phone":"+1 415 555 0181","source_name":"Website","stage_name":"Proposal","status":"qualified","score":85,"deal_value":117000,"notes":"Revenue Operations wants regional pipeline views that preserve the normal deal process for fintech API expansion deals.","tags":"revops,regional-views","created_days_ago":20,"updated_days_ago":2,"activity_subject":"Regional view proposal","activity_detail":"Reviewed regional ownership, forecast rollups, and implementation timeline.","follow_up":"Send regional view pricing and delivery plan."},
    {"company_slug":"plaid","company_name":"Plaid","industry":"Financial APIs","website":"https://plaid.com","contact_name":"Sophie Martin","contact_title":"Partnerships Lead","contact_email":"sophie.martin.plaid@forkable.site","contact_phone":"+1 415 555 0119","source_name":"Partner","stage_name":"Contacted","status":"contacted","score":59,"deal_value":34000,"notes":"Partnerships needs a lightweight account-planning view for bank partners in EMEA.","tags":"partnerships,emea","created_days_ago":7,"updated_days_ago":1,"activity_subject":"Partner planning call","activity_detail":"Discussed EMEA bank partner segmentation and follow-up cadence.","follow_up":"Send partner planning sample view."},
    {"company_slug":"plaid","company_name":"Plaid","industry":"Financial APIs","website":"https://plaid.com","contact_name":"Gabe Miller","contact_title":"Finance Manager","contact_email":"gabe.miller.plaid@forkable.site","contact_phone":"+1 415 555 0164","source_name":"Referral","stage_name":"Closed Won","status":"qualified","score":88,"deal_value":82000,"notes":"Finance approved the initial regional forecasting workspace and wants expansion metrics next month.","tags":"finance,closed-won","created_days_ago":69,"updated_days_ago":12,"activity_subject":"Forecast workspace acceptance","activity_detail":"Confirmed initial workspace success criteria and next expansion metrics.","follow_up":"Prepare regional forecast expansion metrics."},
    {"company_slug":"instacart","company_name":"Instacart","industry":"Marketplace logistics","website":"https://www.instacart.com","contact_name":"Amara Singh","contact_title":"VP Marketplace Operations","contact_email":"amara.singh.instacart@forkable.site","contact_phone":"+1 415 555 0173","source_name":"Executive Intro","stage_name":"Qualified","status":"qualified","score":82,"deal_value":136000,"notes":"Marketplace Operations wants pipeline rollups by market and delivery segment for the enterprise team.","tags":"marketplace,regional-views","created_days_ago":16,"updated_days_ago":2,"activity_subject":"Market pipeline discovery","activity_detail":"Mapped region and marketplace segment requirements.","follow_up":"Send market-level pipeline view proposal."},
    {"company_slug":"instacart","company_name":"Instacart","industry":"Marketplace logistics","website":"https://www.instacart.com","contact_name":"Theo Nguyen","contact_title":"Enterprise Sales Manager","contact_email":"theo.nguyen.instacart@forkable.site","contact_phone":"+1 415 555 0146","source_name":"Webinar","stage_name":"Discovery","status":"contacted","score":61,"deal_value":45000,"notes":"Enterprise Sales is exploring regional views for retail media opportunities next quarter.","tags":"enterprise-sales,discovery","created_days_ago":9,"updated_days_ago":1,"activity_subject":"Retail media pipeline call","activity_detail":"Discussed regional view needs for retail media account planning.","follow_up":"Share retail media forecast mockup."},
    {"company_slug":"instacart","company_name":"Instacart","industry":"Marketplace logistics","website":"https://www.instacart.com","contact_name":"Claire Evans","contact_title":"Procurement Specialist","contact_email":"claire.evans.instacart@forkable.site","contact_phone":"+1 415 555 0187","source_name":"Email Campaign","stage_name":"Lost","status":"unqualified","score":32,"deal_value":26000,"notes":"Procurement parked the request until marketplace operations confirms next-quarter budget.","tags":"procurement,paused","created_days_ago":43,"updated_days_ago":15,"activity_subject":"Budget timing check","activity_detail":"Confirmed request is parked until budget review.","follow_up":"Check back after marketplace operations budget review."},
    {"company_slug":"atlassian","company_name":"Atlassian","industry":"Team collaboration software","website":"https://www.atlassian.com","contact_name":"Daniel Kim","contact_title":"Enterprise Sales Director","contact_email":"daniel.kim.atlassian@forkable.site","contact_phone":"+61 2 5550 0142","source_name":"Trade Show","stage_name":"Contract Sent","status":"qualified","score":90,"deal_value":158000,"notes":"Enterprise Sales is testing approval gates on strategic collaboration-suite deals before broader rollout.","tags":"enterprise-sales,approval-gate","created_days_ago":36,"updated_days_ago":5,"activity_subject":"Approval gate contract review","activity_detail":"Reviewed contract-stage requirements and approver assignments.","follow_up":"Confirm approved legal-review event is attached to contract."},
    {"company_slug":"atlassian","company_name":"Atlassian","industry":"Team collaboration software","website":"https://www.atlassian.com","contact_name":"Grace Park","contact_title":"Sales Enablement Lead","contact_email":"grace.park.atlassian@forkable.site","contact_phone":"+61 2 5550 0179","source_name":"Webinar","stage_name":"Contacted","status":"contacted","score":57,"deal_value":30000,"notes":"Sales Enablement needs workflow training if the Enterprise Sales pilot is approved.","tags":"enablement,training","created_days_ago":5,"updated_days_ago":1,"activity_subject":"Enablement planning","activity_detail":"Captured training needs for approval-gate rollout.","follow_up":"Send approval workflow enablement deck."},
    {"company_slug":"atlassian","company_name":"Atlassian","industry":"Team collaboration software","website":"https://www.atlassian.com","contact_name":"Mira Jensen","contact_title":"Legal Counsel","contact_email":"mira.jensen.atlassian@forkable.site","contact_phone":"+61 2 5550 0138","source_name":"Referral","stage_name":"Security Review","status":"qualified","score":77,"deal_value":99000,"notes":"Legal is reviewing how approval evidence should be captured before Enterprise Sales expands the workflow.","tags":"legal,security-review","created_days_ago":14,"updated_days_ago":2,"activity_subject":"Legal evidence review","activity_detail":"Discussed approval audit events and retention requirements.","follow_up":"Send audit event schema to Legal."},
    {"company_slug":"hubspot","company_name":"HubSpot","industry":"CRM platform","website":"https://www.hubspot.com","contact_name":"Rachel Stone","contact_title":"Sales Operations Manager","contact_email":"rachel.stone.hubspot@forkable.site","contact_phone":"+1 617 555 0113","source_name":"Website","stage_name":"Proposal","status":"qualified","score":80,"deal_value":102000,"notes":"Sales Operations is a standard-product control account. They should not see enterprise approval UI despite the high deal value.","tags":"sales-ops,control","created_days_ago":22,"updated_days_ago":3,"activity_subject":"Standard workflow proposal","activity_detail":"Reviewed standard pipeline workflow and dashboard needs.","follow_up":"Send final standard CRM proposal."},
    {"company_slug":"hubspot","company_name":"HubSpot","industry":"CRM platform","website":"https://www.hubspot.com","contact_name":"Tyler Chen","contact_title":"Customer Education Lead","contact_email":"tyler.chen.hubspot@forkable.site","contact_phone":"+1 617 555 0155","source_name":"Email Campaign","stage_name":"New Lead","status":"new","score":45,"deal_value":19000,"notes":"Customer Education is interested in lightweight onboarding templates for internal teams.","tags":"education,new","created_days_ago":3,"updated_days_ago":1,"activity_subject":"Education intake","activity_detail":"Captured onboarding template goals and timeline.","follow_up":"Send onboarding template examples."},
    {"company_slug":"hubspot","company_name":"HubSpot","industry":"CRM platform","website":"https://www.hubspot.com","contact_name":"Ivy Cohen","contact_title":"Procurement Analyst","contact_email":"ivy.cohen.hubspot@forkable.site","contact_phone":"+1 617 555 0192","source_name":"Referral","stage_name":"Lost","status":"unqualified","score":27,"deal_value":24000,"notes":"Procurement marked the request low priority until the next sales-ops platform review.","tags":"procurement,paused","created_days_ago":57,"updated_days_ago":18,"activity_subject":"Procurement closeout","activity_detail":"Confirmed request is parked until platform review.","follow_up":"Revisit after sales-ops platform review."},
    {"company_slug":"canva","company_name":"Canva","industry":"Visual communication platform","website":"https://www.canva.com","contact_name":"Isla Murphy","contact_title":"Customer Success Operations Lead","contact_email":"isla.murphy.canva@forkable.site","contact_phone":"+61 2 5550 0183","source_name":"Product Signup","stage_name":"Qualified","status":"qualified","score":84,"deal_value":73000,"notes":"Customer Success wants implementation risk scoring to time expansion workshops and executive check-ins.","tags":"customer-success,risk-score","created_days_ago":11,"updated_days_ago":1,"activity_subject":"CS risk scoring workshop","activity_detail":"Mapped launch readiness signals and executive sponsor checkpoints.","follow_up":"Send CS risk-score dashboard preview."},
    {"company_slug":"canva","company_name":"Canva","industry":"Visual communication platform","website":"https://www.canva.com","contact_name":"Ben Hart","contact_title":"Enterprise Growth Manager","contact_email":"ben.hart.canva@forkable.site","contact_phone":"+61 2 5550 0127","source_name":"Partner","stage_name":"Proposal","status":"qualified","score":76,"deal_value":69000,"notes":"Enterprise Growth is coordinating expansion timing with Customer Success risk score output.","tags":"enterprise-growth,proposal","created_days_ago":23,"updated_days_ago":4,"activity_subject":"Expansion timing proposal","activity_detail":"Reviewed how risk score influences rollout timing and sponsor coverage.","follow_up":"Confirm expansion workshop date."},
    {"company_slug":"canva","company_name":"Canva","industry":"Visual communication platform","website":"https://www.canva.com","contact_name":"Mika Tan","contact_title":"Business Operations Director","contact_email":"mika.tan.canva@forkable.site","contact_phone":"+61 2 5550 0195","source_name":"Website","stage_name":"Closed Won","status":"qualified","score":90,"deal_value":88000,"notes":"Business Operations closed the first risk-score workspace and is tracking adoption with Customer Success.","tags":"bizops,closed-won","created_days_ago":77,"updated_days_ago":11,"activity_subject":"Risk workspace closeout","activity_detail":"Confirmed workspace acceptance and adoption tracking plan.","follow_up":"Review adoption data with Business Operations."},
    {"company_slug":"ramp","company_name":"Ramp","industry":"Spend management","website":"https://ramp.com","contact_name":"Vivian Brooks","contact_title":"Security Program Manager","contact_email":"vivian.brooks.ramp@forkable.site","contact_phone":"+1 212 555 0136","source_name":"Executive Intro","stage_name":"Discovery","status":"contacted","score":74,"deal_value":92000,"notes":"Security is preparing a questionnaire workflow for finance stakeholders and external vendor reviews.","tags":"security,questionnaire","created_days_ago":12,"updated_days_ago":2,"activity_subject":"Security questionnaire intake","activity_detail":"Mapped reviewer roles, evidence requirements, and due dates.","follow_up":"Send questionnaire workflow plan to Security."},
    {"company_slug":"ramp","company_name":"Ramp","industry":"Spend management","website":"https://ramp.com","contact_name":"Ethan Rossi","contact_title":"Finance Operations Lead","contact_email":"ethan.rossi.ramp@forkable.site","contact_phone":"+1 212 555 0162","source_name":"Referral","stage_name":"Proposal","status":"qualified","score":78,"deal_value":109000,"notes":"Finance Operations wants vendor review status surfaced in the pipeline, but no approval gate should appear for Ramp.","tags":"finance-ops,proposal","created_days_ago":25,"updated_days_ago":3,"activity_subject":"Finance operations proposal","activity_detail":"Reviewed vendor review status and reporting needs.","follow_up":"Send finance workflow proposal."},
    {"company_slug":"ramp","company_name":"Ramp","industry":"Spend management","website":"https://ramp.com","contact_name":"Sasha Mehta","contact_title":"Procurement Manager","contact_email":"sasha.mehta.ramp@forkable.site","contact_phone":"+1 212 555 0185","source_name":"Email Campaign","stage_name":"Contacted","status":"contacted","score":55,"deal_value":42000,"notes":"Procurement is checking vendor-review reporting before joining the security workflow pilot.","tags":"procurement,contacted","created_days_ago":6,"updated_days_ago":1,"activity_subject":"Procurement qualification call","activity_detail":"Discussed vendor-review reporting and procurement handoff needs.","follow_up":"Send vendor review reporting example."}
  ]
  $json$::jsonb;
BEGIN
  UPDATE public.lead_stages
  SET name = 'Proposal'
  WHERE user_id = p_user_id
    AND name = 'Proposal Sent';

  UPDATE public.lead_stages
  SET name = 'Closed Won'
  WHERE user_id = p_user_id
    AND name = 'Won';

  WITH source_values AS (
    SELECT *
    FROM (
      VALUES
        ('Website', 'Inbound demo and trial requests.'),
        ('Referral', 'Introductions from customers, investors, and partners.'),
        ('Social Media', 'LinkedIn, community, and founder-led social campaigns.'),
        ('Cold Call', 'Outbound calls to target accounts.'),
        ('Email Campaign', 'Lifecycle and event follow-up email programs.'),
        ('Trade Show', 'Conference booth scans and field events.'),
        ('Product Signup', 'Product-led signups and workspace creation.'),
        ('Executive Intro', 'Executive sponsor or investor introduction.'),
        ('Partner', 'Technology, agency, and channel partner referrals.'),
        ('Webinar', 'Virtual events and educational webinars.'),
        ('Other', 'Manually sourced or imported records.')
    ) AS values(name, description)
  )
  INSERT INTO public.lead_sources (name, description, user_id)
  SELECT name, description, p_user_id
  FROM source_values
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_sources existing
    WHERE existing.user_id = p_user_id
      AND existing.name = source_values.name
  );

  WITH stage_values AS (
    SELECT *
    FROM (
      VALUES
        ('New Lead', 'Untriaged inbound or sourced lead.', 1),
        ('Contacted', 'Initial outreach completed and next step requested.', 2),
        ('Discovery', 'Business problem, team ownership, and timing are being mapped.', 3),
        ('Qualified', 'Need, authority, timeline, and value are validated.', 4),
        ('Proposal', 'Commercial proposal or implementation plan is under review.', 5),
        ('Security Review', 'Security, legal, procurement, or compliance review is active.', 6),
        ('Contract Sent', 'Order form, MSA, or security packet is in contracting.', 7),
        ('Closed Won', 'Deal is won and ready for delivery or expansion tracking.', 8),
        ('Lost', 'Closed out or intentionally parked.', 9)
    ) AS values(name, description, order_index)
  )
  INSERT INTO public.lead_stages (name, description, order_index, user_id)
  SELECT name, description, order_index, p_user_id
  FROM stage_values
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_stages existing
    WHERE existing.user_id = p_user_id
      AND existing.name = stage_values.name
  );

  WITH old_leads AS (
    SELECT id
    FROM public.leads
    WHERE user_id = p_user_id
      AND (
        company_name IN ('Acme Industrial', 'BetaCorp Financial', 'BetaCorp Pilot')
        OR lower(coalesce(contact_email, '')) LIKE '%.acme@forkable.site'
        OR lower(coalesce(contact_email, '')) LIKE '%@acme.example'
        OR lower(coalesce(contact_email, '')) LIKE '%@betacorp.example'
      )
  )
  DELETE FROM public.lead_conversions conversions
  USING old_leads
  WHERE conversions.lead_id = old_leads.id
    AND conversions.user_id = p_user_id;

  DELETE FROM public.leads
  WHERE user_id = p_user_id
    AND (
      company_name IN ('Acme Industrial', 'BetaCorp Financial', 'BetaCorp Pilot')
      OR lower(coalesce(contact_email, '')) LIKE '%.acme@forkable.site'
      OR lower(coalesce(contact_email, '')) LIKE '%@acme.example'
      OR lower(coalesce(contact_email, '')) LIKE '%@betacorp.example'
    );

  DELETE FROM public.projects projects
  USING public.clients clients
  WHERE projects.user_id = p_user_id
    AND projects.client_id = clients.id
    AND clients.user_id = p_user_id
    AND clients.client_code IN ('ACME', 'BETA');

  DELETE FROM public.clients
  WHERE user_id = p_user_id
    AND client_code IN ('ACME', 'BETA');

  DELETE FROM public.customer_feature_flags
  WHERE user_id = p_user_id
    AND customer_email IN ('acme@forkable.site', 'betacorp@forkable.site');

  WITH demo_companies AS (
    SELECT *
    FROM jsonb_to_recordset(v_companies) AS company_data(
      name text,
      slug text,
      domain text,
      website text,
      industry text,
      segment text,
      client_code text,
      address text,
      postal_code text,
      country_code text,
      notes text
    )
  )
  INSERT INTO public.company_accounts (
    name,
    slug,
    domain,
    website,
    industry,
    segment,
    address,
    postal_code,
    country_code,
    notes,
    user_id
  )
  SELECT
    name,
    slug,
    domain,
    website,
    industry,
    segment,
    address,
    postal_code,
    country_code,
    notes,
    p_user_id
  FROM demo_companies
  ON CONFLICT (user_id, slug)
  DO UPDATE SET
    name = EXCLUDED.name,
    domain = EXCLUDED.domain,
    website = EXCLUDED.website,
    industry = EXCLUDED.industry,
    segment = EXCLUDED.segment,
    address = EXCLUDED.address,
    postal_code = EXCLUDED.postal_code,
    country_code = EXCLUDED.country_code,
    notes = EXCLUDED.notes,
    updated_at = now();

  WITH demo_companies AS (
    SELECT *
    FROM jsonb_to_recordset(v_companies) AS company_data(
      name text,
      slug text,
      client_code text,
      address text,
      postal_code text,
      country_code text
    )
  ), resolved AS (
    SELECT
      demo_companies.name,
      demo_companies.client_code,
      demo_companies.address,
      demo_companies.postal_code,
      demo_companies.country_code,
      accounts.id AS company_account_id
    FROM demo_companies
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = demo_companies.slug
  )
  INSERT INTO public.clients (
    name,
    client_code,
    address,
    postal_code,
    country_code,
    company_account_id,
    user_id
  )
  SELECT
    name,
    client_code,
    address,
    postal_code,
    country_code,
    company_account_id,
    p_user_id
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.clients existing
    WHERE existing.user_id = p_user_id
      AND existing.client_code = resolved.client_code
      AND existing.is_deleted = false
  );

  UPDATE public.clients clients
  SET name = resolved.name,
      address = resolved.address,
      postal_code = resolved.postal_code,
      country_code = resolved.country_code,
      company_account_id = resolved.company_account_id,
      updated_at = now()
  FROM (
    SELECT
      company_data.name,
      company_data.client_code,
      company_data.address,
      company_data.postal_code,
      company_data.country_code,
      accounts.id AS company_account_id
    FROM jsonb_to_recordset(v_companies) AS company_data(
      name text,
      slug text,
      client_code text,
      address text,
      postal_code text,
      country_code text
    )
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = company_data.slug
  ) resolved
  WHERE clients.user_id = p_user_id
    AND clients.client_code = resolved.client_code
    AND clients.is_deleted = false;

  WITH demo_logins AS (
    SELECT
      accounts.id AS company_account_id,
      accounts.slug || '@forkable.site' AS email,
      accounts.name || ' Demo User' AS full_name,
      'Demo workspace user' AS title,
      'Admin' AS account_role,
      true AS is_demo_login
    FROM public.company_accounts accounts
    WHERE accounts.user_id = p_user_id
      AND accounts.slug IN (
        SELECT slug
        FROM jsonb_to_recordset(v_companies) AS company_data(slug text)
      )
  ), lead_members AS (
    SELECT
      accounts.id AS company_account_id,
      leads.contact_email AS email,
      leads.contact_name AS full_name,
      leads.contact_title AS title,
      'Buyer' AS account_role,
      false AS is_demo_login
    FROM jsonb_to_recordset(v_leads) AS leads(
      company_slug text,
      contact_name text,
      contact_title text,
      contact_email text
    )
    JOIN public.company_accounts accounts
      ON accounts.user_id = p_user_id
     AND accounts.slug = leads.company_slug
  ), members AS (
    SELECT * FROM demo_logins
    UNION ALL
    SELECT * FROM lead_members
  )
  INSERT INTO public.company_account_members (
    company_account_id,
    email,
    full_name,
    title,
    account_role,
    is_demo_login,
    user_id
  )
  SELECT
    company_account_id,
    email,
    full_name,
    title,
    account_role,
    is_demo_login,
    p_user_id
  FROM members
  ON CONFLICT (user_id, email)
  DO UPDATE SET
    company_account_id = EXCLUDED.company_account_id,
    full_name = EXCLUDED.full_name,
    title = EXCLUDED.title,
    account_role = EXCLUDED.account_role,
    is_demo_login = EXCLUDED.is_demo_login,
    updated_at = now();

  PERFORM public.seed_forkable_demo(p_user_id);

  WITH project_values AS (
    SELECT *
    FROM (
      VALUES
        ('Enterprise approval gate rollout', 'SHOPIFY', 34, 28, 'active', true, 'Shopify Enterprise Sales approval gate with legal-review audit evidence.'),
        ('Strategic deal risk scoring', 'SHOPIFY', 12, 44, 'active', true, 'Risk score for expansion opportunities and executive sponsor coverage.'),
        ('Regional pipeline forecast views', 'STRIPE', 18, 36, 'active', true, 'Regional forecast views split by North America, EMEA, and APAC.'),
        ('Implementation risk score rollout', 'DDOG', 22, 47, 'active', true, 'Risk scoring for enterprise expansion deals.'),
        ('Mutual action plan templates', 'FIGMA', 15, 53, 'active', true, 'Template library for enterprise rollout plans.'),
        ('Approval evidence export', 'SNOW', 27, 39, 'active', true, 'Legal approval gate and evidence export for data-cloud contracts.'),
        ('Questionnaire workspace discovery', 'CF', 9, 58, 'active', true, 'Security questionnaire owner assignment and audit history.'),
        ('Regional account planning', 'PLAID', 31, NULL, 'active', true, 'Regional pipeline views for bank-partner expansion.'),
        ('Market-level pipeline rollups', 'INSTA', 14, 42, 'active', true, 'Pipeline rollups by market and delivery segment.'),
        ('Enterprise approval gate pilot', 'ATLAS', 26, 31, 'active', true, 'Atlassian Enterprise Sales approval gate pilot.'),
        ('Standard CRM workflow', 'HUBSPOT', 19, 35, 'active', true, 'Control account using the standard product behavior.'),
        ('CS risk scoring workspace', 'CANVA', 40, -8, 'completed', true, 'Customer Success implementation risk workspace.'),
        ('Finance security review workspace', 'RAMP', 8, 49, 'active', true, 'Security questionnaire workflow for finance stakeholders.')
    ) AS projects(name, client_code, started_days_ago, ends_in_days, deal_status, billable, note)
  )
  INSERT INTO public.projects (
    name,
    client_id,
    currency,
    start_date,
    end_date,
    deal_status,
    billable,
    note,
    user_id
  )
  SELECT
    project_values.name,
    clients.id,
    'USD',
    current_date - project_values.started_days_ago,
    CASE
      WHEN project_values.ends_in_days IS NULL THEN NULL
      ELSE current_date + project_values.ends_in_days
    END,
    project_values.deal_status,
    project_values.billable,
    project_values.note,
    p_user_id
  FROM project_values
  JOIN public.clients clients
    ON clients.user_id = p_user_id
   AND clients.client_code = project_values.client_code
   AND clients.is_deleted = false
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.projects existing
    WHERE existing.user_id = p_user_id
      AND existing.client_id = clients.id
      AND existing.name = project_values.name
  );

  WITH demo_leads AS (
    SELECT *
    FROM jsonb_to_recordset(v_leads) AS lead_data(
      company_slug text,
      company_name text,
      industry text,
      website text,
      contact_name text,
      contact_title text,
      contact_email text,
      contact_phone text,
      source_name text,
      stage_name text,
      status text,
      score integer,
      deal_value numeric,
      notes text,
      tags text,
      created_days_ago integer,
      updated_days_ago integer,
      activity_subject text,
      activity_detail text,
      follow_up text
    )
  )
  UPDATE public.leads leads
  SET company_name = demo_leads.company_name,
      industry = demo_leads.industry,
      website = demo_leads.website,
      contact_name = demo_leads.contact_name,
      contact_title = demo_leads.contact_title,
      contact_phone = demo_leads.contact_phone,
      company_account_id = accounts.id,
      source_id = (
        SELECT id FROM public.lead_sources
        WHERE user_id = p_user_id AND name = demo_leads.source_name
        LIMIT 1
      ),
      current_stage_id = (
        SELECT id FROM public.lead_stages
        WHERE user_id = p_user_id AND name = demo_leads.stage_name
        LIMIT 1
      ),
      status = demo_leads.status,
      score = demo_leads.score,
      notes = demo_leads.notes,
      tags = string_to_array(demo_leads.tags, ','),
      deal_value = demo_leads.deal_value,
      updated_at = now() - (demo_leads.updated_days_ago * interval '1 day')
  FROM demo_leads
  JOIN public.company_accounts accounts
    ON accounts.user_id = p_user_id
   AND accounts.slug = demo_leads.company_slug
  WHERE leads.user_id = p_user_id
    AND lower(leads.contact_email) = lower(demo_leads.contact_email);

  WITH demo_leads AS (
    SELECT *
    FROM jsonb_to_recordset(v_leads) AS lead_data(
      company_slug text,
      company_name text,
      industry text,
      website text,
      contact_name text,
      contact_title text,
      contact_email text,
      contact_phone text,
      source_name text,
      stage_name text,
      status text,
      score integer,
      deal_value numeric,
      notes text,
      tags text,
      created_days_ago integer,
      updated_days_ago integer,
      activity_subject text,
      activity_detail text,
      follow_up text
    )
  )
  INSERT INTO public.leads (
    company_name,
    industry,
    website,
    contact_name,
    contact_title,
    contact_email,
    contact_phone,
    company_account_id,
    source_id,
    current_stage_id,
    status,
    score,
    notes,
    tags,
    deal_value,
    user_id,
    created_at,
    updated_at
  )
  SELECT
    demo_leads.company_name,
    demo_leads.industry,
    demo_leads.website,
    demo_leads.contact_name,
    demo_leads.contact_title,
    demo_leads.contact_email,
    demo_leads.contact_phone,
    accounts.id,
    sources.id,
    stages.id,
    demo_leads.status,
    demo_leads.score,
    demo_leads.notes,
    string_to_array(demo_leads.tags, ','),
    demo_leads.deal_value,
    p_user_id,
    now() - (demo_leads.created_days_ago * interval '1 day'),
    now() - (demo_leads.updated_days_ago * interval '1 day')
  FROM demo_leads
  JOIN public.company_accounts accounts
    ON accounts.user_id = p_user_id
   AND accounts.slug = demo_leads.company_slug
  LEFT JOIN public.lead_sources sources
    ON sources.user_id = p_user_id
   AND sources.name = demo_leads.source_name
  LEFT JOIN public.lead_stages stages
    ON stages.user_id = p_user_id
   AND stages.name = demo_leads.stage_name
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.leads existing
    WHERE existing.user_id = p_user_id
      AND lower(existing.contact_email) = lower(demo_leads.contact_email)
  );

  WITH demo_contacts AS (
    SELECT contact_email
    FROM jsonb_to_recordset(v_leads) AS lead_data(contact_email text)
  )
  INSERT INTO public.lead_stage_history (
    lead_id,
    from_stage_id,
    to_stage_id,
    changed_by,
    changed_at,
    notes,
    user_id
  )
  SELECT
    leads.id,
    NULL,
    leads.current_stage_id,
    p_user_id,
    leads.created_at + interval '2 hours',
    'Seeded initial stage for the realistic multi-company demo pipeline.',
    p_user_id
  FROM public.leads leads
  JOIN demo_contacts ON lower(demo_contacts.contact_email) = lower(leads.contact_email)
  WHERE leads.user_id = p_user_id
    AND leads.current_stage_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_stage_history history
      WHERE history.lead_id = leads.id
        AND history.user_id = p_user_id
    );

  WITH demo_leads AS (
    SELECT
      leads.id,
      leads.contact_email,
      lead_data.activity_subject,
      lead_data.activity_detail,
      lead_data.follow_up,
      leads.company_name,
      leads.contact_name,
      leads.deal_value,
      leads.created_at,
      leads.updated_at,
      stages.name AS stage_name
    FROM jsonb_to_recordset(v_leads) AS lead_data(
      contact_email text,
      activity_subject text,
      activity_detail text,
      follow_up text
    )
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(lead_data.contact_email)
    LEFT JOIN public.lead_stages stages ON stages.id = leads.current_stage_id
  ), generated_activities AS (
    SELECT
      id AS lead_id,
      'call' AS type,
      activity_subject AS subject,
      activity_detail AS description,
      created_at + interval '1 day' AS activity_date,
      30 AS duration_minutes,
      'completed' AS status
    FROM demo_leads
    UNION ALL
    SELECT
      id,
      'email',
      'Next steps recap',
      'Sent recap with owner, open decision, target date, and the next milestone for ' || coalesce(stage_name, 'the current') || ' stage.',
      updated_at - interval '8 hours',
      NULL,
      'sent'
    FROM demo_leads
    UNION ALL
    SELECT
      id,
      'meeting',
      'Commercial review',
      'Reviewed scope, mutual action plan, success criteria, and implementation risk for the high-value opportunity.',
      updated_at - interval '2 days',
      45,
      'completed'
    FROM demo_leads
    WHERE deal_value >= 50000
  )
  INSERT INTO public.lead_activities (
    lead_id,
    type,
    subject,
    description,
    activity_date,
    duration_minutes,
    status,
    user_id
  )
  SELECT
    generated_activities.lead_id,
    generated_activities.type,
    generated_activities.subject,
    generated_activities.description,
    generated_activities.activity_date,
    generated_activities.duration_minutes,
    generated_activities.status,
    p_user_id
  FROM generated_activities
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_activities existing
    WHERE existing.lead_id = generated_activities.lead_id
      AND existing.user_id = p_user_id
      AND existing.subject = generated_activities.subject
  );

  WITH demo_leads AS (
    SELECT
      leads.id,
      leads.deal_value,
      leads.is_converted,
      lead_data.follow_up,
      stages.name AS stage_name
    FROM jsonb_to_recordset(v_leads) AS lead_data(
      contact_email text,
      follow_up text
    )
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(lead_data.contact_email)
    LEFT JOIN public.lead_stages stages ON stages.id = leads.current_stage_id
    WHERE leads.user_id = p_user_id
      AND leads.is_converted = false
  ), generated_follow_ups AS (
    SELECT
      id AS lead_id,
      CASE
        WHEN deal_value >= 100000 THEN now() + interval '1 day'
        WHEN stage_name IN ('Proposal', 'Security Review', 'Contract Sent') THEN now() + interval '2 days'
        ELSE now() + interval '5 days'
      END AS due_date,
      CASE
        WHEN deal_value >= 100000 THEN 'high'
        WHEN stage_name IN ('Proposal', 'Security Review', 'Contract Sent') THEN 'medium'
        ELSE 'low'
      END AS priority,
      'pending' AS status,
      follow_up AS description,
      NULL::timestamptz AS completed_at
    FROM demo_leads
    WHERE stage_name <> 'Lost'
    UNION ALL
    SELECT
      id,
      now() - interval '3 days',
      'medium',
      'completed',
      'Send stakeholder map and mutual action plan.',
      now() - interval '2 days'
    FROM demo_leads
    WHERE stage_name IN ('Qualified', 'Proposal', 'Security Review', 'Contract Sent')
  )
  INSERT INTO public.lead_follow_ups (
    lead_id,
    due_date,
    priority,
    status,
    description,
    completed_at,
    user_id
  )
  SELECT
    generated_follow_ups.lead_id,
    generated_follow_ups.due_date,
    generated_follow_ups.priority,
    generated_follow_ups.status,
    generated_follow_ups.description,
    generated_follow_ups.completed_at,
    p_user_id
  FROM generated_follow_ups
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_follow_ups existing
    WHERE existing.lead_id = generated_follow_ups.lead_id
      AND existing.user_id = p_user_id
      AND existing.description = generated_follow_ups.description
  );

  WITH conversions AS (
    SELECT *
    FROM (
      VALUES
        ('nadia.torres.stripe@forkable.site', 'STRIPE', 76000::numeric, 'Converted after finance accepted the initial forecasting workspace.', 10),
        ('olivia.marsh.figma@forkable.site', 'FIGMA', 54000::numeric, 'Converted after business operations accepted the reporting workspace.', 9),
        ('gabe.miller.plaid@forkable.site', 'PLAID', 82000::numeric, 'Converted after regional forecasting sign-off.', 12),
        ('mika.tan.canva@forkable.site', 'CANVA', 88000::numeric, 'Converted after risk-score workspace acceptance.', 11)
    ) AS seeded(contact_email, client_code, deal_value, conversion_notes, converted_days_ago)
  ), resolved AS (
    SELECT
      leads.id AS lead_id,
      clients.id AS client_id,
      conversions.deal_value,
      conversions.conversion_notes,
      conversions.converted_days_ago
    FROM conversions
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(conversions.contact_email)
    JOIN public.clients clients
      ON clients.user_id = p_user_id
     AND clients.client_code = conversions.client_code
     AND clients.is_deleted = false
  )
  UPDATE public.leads leads
  SET is_converted = true,
      converted_to_client_id = resolved.client_id,
      converted_at = now() - (resolved.converted_days_ago * interval '1 day')
  FROM resolved
  WHERE leads.id = resolved.lead_id
    AND leads.user_id = p_user_id;

  WITH conversions AS (
    SELECT *
    FROM (
      VALUES
        ('nadia.torres.stripe@forkable.site', 'STRIPE', 76000::numeric, 'Converted after finance accepted the initial forecasting workspace.', 10),
        ('olivia.marsh.figma@forkable.site', 'FIGMA', 54000::numeric, 'Converted after business operations accepted the reporting workspace.', 9),
        ('gabe.miller.plaid@forkable.site', 'PLAID', 82000::numeric, 'Converted after regional forecasting sign-off.', 12),
        ('mika.tan.canva@forkable.site', 'CANVA', 88000::numeric, 'Converted after risk-score workspace acceptance.', 11)
    ) AS seeded(contact_email, client_code, deal_value, conversion_notes, converted_days_ago)
  ), resolved AS (
    SELECT
      leads.id AS lead_id,
      clients.id AS client_id,
      conversions.deal_value,
      conversions.conversion_notes,
      conversions.converted_days_ago
    FROM conversions
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(conversions.contact_email)
    JOIN public.clients clients
      ON clients.user_id = p_user_id
     AND clients.client_code = conversions.client_code
     AND clients.is_deleted = false
  )
  INSERT INTO public.lead_conversions (
    lead_id,
    client_id,
    converted_at,
    converted_by,
    deal_value,
    conversion_notes,
    user_id
  )
  SELECT
    resolved.lead_id,
    resolved.client_id,
    now() - (resolved.converted_days_ago * interval '1 day'),
    p_user_id,
    resolved.deal_value,
    resolved.conversion_notes,
    p_user_id
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_conversions existing
    WHERE existing.lead_id = resolved.lead_id
      AND existing.user_id = p_user_id
  );

  WITH approval_values AS (
    SELECT *
    FROM (
      VALUES
        ('caleb.torres.shopify@forkable.site', 'approved', 'Legal Review approved for Shopify procurement packet.', 4, 3),
        ('leah.watanabe.snowflake@forkable.site', 'pending', 'Legal Review requested before expansion deal can move to Contract Sent.', 1, NULL),
        ('owen.brooks.snowflake@forkable.site', 'approved', 'Legal Review approved for Snowflake contract packet.', 5, 4),
        ('daniel.kim.atlassian@forkable.site', 'approved', 'Legal Review approved for Atlassian Enterprise Sales pilot.', 5, 4)
    ) AS approvals(contact_email, status, reason, requested_days_ago, approved_days_ago)
  ), resolved AS (
    SELECT
      leads.id AS lead_id,
      leads.deal_value,
      approval_values.status,
      approval_values.reason,
      approval_values.requested_days_ago,
      approval_values.approved_days_ago
    FROM approval_values
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(approval_values.contact_email)
  )
  INSERT INTO public.deal_approval_requests (
    lead_id,
    requested_by,
    status,
    amount,
    reason,
    created_at,
    approved_at,
    user_id
  )
  SELECT
    lead_id,
    p_user_id,
    status,
    deal_value,
    reason,
    now() - (requested_days_ago * interval '1 day'),
    CASE
      WHEN approved_days_ago IS NULL THEN NULL
      ELSE now() - (approved_days_ago * interval '1 day')
    END,
    p_user_id
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.deal_approval_requests existing
    WHERE existing.lead_id = resolved.lead_id
      AND existing.user_id = p_user_id
      AND existing.reason = resolved.reason
  );

  INSERT INTO public.deal_approval_steps (
    approval_request_id,
    name,
    status,
    completed_by,
    completed_at,
    user_id
  )
  SELECT
    requests.id,
    'Legal Review',
    CASE WHEN requests.status = 'approved' THEN 'approved' ELSE 'pending' END,
    CASE WHEN requests.status = 'approved' THEN p_user_id ELSE NULL END,
    requests.approved_at,
    p_user_id
  FROM public.deal_approval_requests requests
  WHERE requests.user_id = p_user_id
    AND requests.reason IN (
      'Legal Review approved for Shopify procurement packet.',
      'Legal Review requested before expansion deal can move to Contract Sent.',
      'Legal Review approved for Snowflake contract packet.',
      'Legal Review approved for Atlassian Enterprise Sales pilot.'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.deal_approval_steps existing
      WHERE existing.approval_request_id = requests.id
        AND existing.user_id = p_user_id
        AND existing.name = 'Legal Review'
    );

  INSERT INTO public.deal_approval_audit_events (
    approval_request_id,
    lead_id,
    event_type,
    actor_id,
    metadata,
    user_id,
    created_at
  )
  SELECT
    requests.id,
    requests.lead_id,
    'approval_requested',
    p_user_id,
    jsonb_build_object('amount', requests.amount, 'reason', requests.reason),
    p_user_id,
    requests.created_at
  FROM public.deal_approval_requests requests
  WHERE requests.user_id = p_user_id
    AND requests.reason IN (
      'Legal Review approved for Shopify procurement packet.',
      'Legal Review requested before expansion deal can move to Contract Sent.',
      'Legal Review approved for Snowflake contract packet.',
      'Legal Review approved for Atlassian Enterprise Sales pilot.'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.deal_approval_audit_events existing
      WHERE existing.approval_request_id = requests.id
        AND existing.user_id = p_user_id
        AND existing.event_type = 'approval_requested'
    );

  INSERT INTO public.deal_approval_audit_events (
    approval_request_id,
    lead_id,
    event_type,
    actor_id,
    user_id,
    created_at
  )
  SELECT
    requests.id,
    requests.lead_id,
    'approval_approved',
    p_user_id,
    p_user_id,
    requests.approved_at
  FROM public.deal_approval_requests requests
  WHERE requests.user_id = p_user_id
    AND requests.status = 'approved'
    AND requests.reason IN (
      'Legal Review approved for Shopify procurement packet.',
      'Legal Review approved for Snowflake contract packet.',
      'Legal Review approved for Atlassian Enterprise Sales pilot.'
    )
    AND requests.approved_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.deal_approval_audit_events existing
      WHERE existing.approval_request_id = requests.id
        AND existing.user_id = p_user_id
        AND existing.event_type = 'approval_approved'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_company_feature_flag(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_feature_flag(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_has_feature_flag(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_forkable_demo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_forkable_planning_demo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_crm_defaults(uuid) TO authenticated;

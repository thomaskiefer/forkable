CREATE OR REPLACE FUNCTION public.seed_forkable_demo(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_request_id uuid;
  v_run_id uuid;
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
      'Show customer-specific regional pipeline filters and forecast summaries.'
    ),
    (
      'implementation_risk_scoring',
      'Implementation risk scoring',
      'Score open deals for launch complexity, compliance risk, and stakeholder readiness.'
    )
  ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description;

  INSERT INTO public.customer_feature_flags (
    customer_email,
    feature_key,
    enabled,
    user_id
  )
  VALUES
    ('acme@forkable.site', 'enterprise_deal_approvals', true, p_user_id),
    ('acme@forkable.site', 'regional_pipeline_views', false, p_user_id),
    ('acme@forkable.site', 'implementation_risk_scoring', true, p_user_id),
    ('betacorp@forkable.site', 'enterprise_deal_approvals', false, p_user_id),
    ('betacorp@forkable.site', 'regional_pipeline_views', true, p_user_id),
    ('betacorp@forkable.site', 'implementation_risk_scoring', false, p_user_id)
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
  SELECT *
  FROM (
    VALUES
      (
        'Enterprise Deal Approval Gate',
        'Acme',
        'acme@forkable.site',
        'Any Acme deal over $50k must go through Legal Review before it can move to Contract Sent or Closed Won.',
        'review',
        'enterprise_deal_approvals',
        p_user_id
      ),
      (
        'Implementation Risk Score',
        'Acme',
        'acme@forkable.site',
        'Add a visible risk score for Acme opportunities based on security review status, integration count, and executive sponsor coverage.',
        'building',
        'implementation_risk_scoring',
        p_user_id
      ),
      (
        'Regional Pipeline Views',
        'BetaCorp',
        'betacorp@forkable.site',
        'BetaCorp wants pipeline views grouped by North America, EMEA, and APAC without changing the standard sales process.',
        'planning',
        'regional_pipeline_views',
        p_user_id
      ),
      (
        'Quarterly Forecast Export',
        'BetaCorp',
        'betacorp@forkable.site',
        'Export a finance-ready forecast with expected close dates, confidence notes, and implementation owner for each active opportunity.',
        'requested',
        NULL,
        p_user_id
      )
  ) AS seeded(title, customer_name, customer_email, description, status, feature_key, user_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.change_requests existing
    WHERE existing.user_id = p_user_id
      AND existing.customer_email = seeded.customer_email
      AND existing.title = seeded.title
  );

  SELECT id INTO v_request_id
  FROM public.change_requests
  WHERE user_id = p_user_id
    AND customer_email = 'acme@forkable.site'
    AND title = 'Enterprise Deal Approval Gate'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_request_id IS NOT NULL THEN
    SELECT id INTO v_run_id
    FROM public.agent_runs
    WHERE change_request_id = v_request_id
      AND user_id = p_user_id
      AND git_branch = 'feat/acme-approval-gate'
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
        'feat/acme-approval-gate',
        'acme-approval-gate',
        'https://preview.forkable.site/acme-approval-gate',
        now() - interval '1 day',
        'Added feature flag, approval persistence, backend enforcement, lead-detail approval actions, and Acme/BetaCorp smoke coverage.',
        'https://github.com/forkable/demo/pull/42',
        '7f4a91c',
        p_user_id
      )
      RETURNING id INTO v_run_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.agent_steps WHERE run_id = v_run_id AND user_id = p_user_id
    ) THEN
      INSERT INTO public.agent_steps (run_id, order_index, label, status, details, completed_at, user_id)
      VALUES
        (v_run_id, 1, 'Indexed CRM repo and seed migrations', 'passed', 'Found lead pipeline, approval RPCs, and customer feature flag tables.', now() - interval '1 day 4 hours', p_user_id),
        (v_run_id, 2, 'Created Git branch feat/acme-approval-gate', 'passed', 'Prepared additive schema changes only.', now() - interval '1 day 3 hours 40 minutes', p_user_id),
        (v_run_id, 3, 'Created InsForge backend branch acme-approval-gate', 'passed', 'Validated branch data against Acme and BetaCorp demo accounts.', now() - interval '1 day 3 hours 20 minutes', p_user_id),
        (v_run_id, 4, 'Added approval tables and policies', 'passed', 'Created approval request, step, and audit tables with user-scoped RLS.', now() - interval '1 day 2 hours 55 minutes', p_user_id),
        (v_run_id, 5, 'Enforced blocked stage transitions', 'passed', 'Blocked high-value Acme deals until Legal Review is approved.', now() - interval '1 day 2 hours 20 minutes', p_user_id),
        (v_run_id, 6, 'Updated lead detail review flow', 'passed', 'Added request and approve actions behind the enterprise feature flag.', now() - interval '1 day 1 hour 50 minutes', p_user_id),
        (v_run_id, 7, 'Deployed preview', 'passed', 'Preview is ready for product review.', now() - interval '1 day 1 hour 20 minutes', p_user_id),
        (v_run_id, 8, 'Ran smoke tests: 8/8 passed', 'passed', 'Verified Acme-specific behavior and unchanged BetaCorp behavior.', now() - interval '1 day', p_user_id);
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
        'https://preview.forkable.site/acme-approval-gate',
        'acme-approval-gate',
        'demo-preview-acme-approval',
        'ready',
        p_user_id
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.test_results WHERE run_id = v_run_id AND user_id = p_user_id
    ) THEN
      INSERT INTO public.test_results (run_id, name, status, details, user_id)
      VALUES
        (v_run_id, 'Base app loads', 'passed', 'CRM dashboard rendered with the seeded Acme and BetaCorp pipeline.', p_user_id),
        (v_run_id, 'Acme login works', 'passed', 'Authenticated as acme@forkable.site.', p_user_id),
        (v_run_id, 'BetaCorp login works', 'passed', 'Authenticated as betacorp@forkable.site.', p_user_id),
        (v_run_id, 'Acme sees approval feature', 'passed', 'Feature flag resolved true for enterprise_deal_approvals.', p_user_id),
        (v_run_id, 'BetaCorp does not see approval feature', 'passed', 'Feature flag resolved false, preserving the standard CRM flow.', p_user_id),
        (v_run_id, 'Acme deal over $50k is blocked without approval', 'passed', 'Database RPC raised Legal Review required.', p_user_id),
        (v_run_id, 'Approval request can be created', 'passed', 'Request and audit rows persisted.', p_user_id),
        (v_run_id, 'Approved deal can advance', 'passed', 'Stage update succeeds after approval.', p_user_id);
    END IF;
  END IF;

  SELECT cr.id INTO v_request_id
  FROM public.change_requests cr
  WHERE cr.user_id = p_user_id
    AND cr.customer_email = 'betacorp@forkable.site'
    AND cr.title = 'Regional Pipeline Views'
  ORDER BY cr.created_at ASC
  LIMIT 1;

  IF v_request_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.agent_runs
      WHERE change_request_id = v_request_id
        AND user_id = p_user_id
        AND git_branch = 'feat/betacorp-regional-pipeline'
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
      'feat/betacorp-regional-pipeline',
      'betacorp-regional-pipeline',
      'https://preview.forkable.site/betacorp-regional-pipeline',
      now() - interval '3 hours',
      'Inspecting regional forecast requirements and pipeline query filters before implementation.',
      p_user_id
    )
    RETURNING id INTO v_run_id;

    INSERT INTO public.agent_steps (run_id, order_index, label, status, details, completed_at, user_id)
    VALUES
      (v_run_id, 1, 'Loaded finalized planning context', 'passed', 'BetaCorp regional views are scoped to reporting and filtering only.', now() - interval '2 hours 45 minutes', p_user_id),
      (v_run_id, 2, 'Inspected lead and dashboard queries', 'passed', 'Found query surfaces for pipeline, list, and dashboard summaries.', now() - interval '2 hours 15 minutes', p_user_id),
      (v_run_id, 3, 'Drafted additive data model', 'running', 'Evaluating whether region should live on lead tags or a dedicated account field.', NULL, p_user_id),
      (v_run_id, 4, 'Implement regional filters', 'pending', NULL, NULL, p_user_id),
      (v_run_id, 5, 'Run BetaCorp smoke tests', 'pending', NULL, NULL, p_user_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_crm_defaults(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_leads jsonb := $json$
  [
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Nina Patel",
      "contact_title": "VP Operations",
      "contact_email": "nia.patel@acme.example",
      "contact_phone": "+1 415 555 0142",
      "source_name": "Website",
      "stage_name": "Proposal",
      "status": "qualified",
      "score": 91,
      "deal_value": 120000,
      "notes": "Acme requested Legal Review before enterprise deals move to Contract Sent or Closed Won. Executive sponsor is aligned; security and legal need a clean approval trail.",
      "tags": "enterprise,approval-gate",
      "created_days_ago": 18,
      "updated_days_ago": 1
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Owen McCarthy",
      "contact_title": "Legal Operations Director",
      "contact_email": "owen.mccarthy@acme.example",
      "contact_phone": "+1 415 555 0178",
      "source_name": "Referral",
      "stage_name": "Contract Sent",
      "status": "qualified",
      "score": 88,
      "deal_value": 86000,
      "notes": "Legal team wants standard approval evidence attached to high-value stage changes. Approved pilot language is already in the contract packet.",
      "tags": "legal,contract",
      "created_days_ago": 27,
      "updated_days_ago": 2
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Priya Shah",
      "contact_title": "Revenue Operations Director",
      "contact_email": "priya.shah@acme.example",
      "contact_phone": "+1 415 555 0196",
      "source_name": "Trade Show",
      "stage_name": "Qualified",
      "status": "qualified",
      "score": 79,
      "deal_value": 64000,
      "notes": "RevOps team is validating custom fields and audit reporting before expanding to two more business units.",
      "tags": "revops,audit",
      "created_days_ago": 13,
      "updated_days_ago": 3
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Dylan Harper",
      "contact_title": "IT Director",
      "contact_email": "dylan.harper@acme.example",
      "contact_phone": "+1 415 555 0161",
      "source_name": "Email Campaign",
      "stage_name": "Contacted",
      "status": "contacted",
      "score": 58,
      "deal_value": 38000,
      "notes": "IT is checking SSO, storage retention, and preview branch access before the next workshop.",
      "tags": "it,sso",
      "created_days_ago": 7,
      "updated_days_ago": 1
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Elise Romero",
      "contact_title": "CFO",
      "contact_email": "elise.romero@acme.example",
      "contact_phone": "+1 415 555 0184",
      "source_name": "Referral",
      "stage_name": "New Lead",
      "status": "new",
      "score": 72,
      "deal_value": 155000,
      "notes": "Finance wants a board-ready view of forecast risk before authorizing a multi-region rollout.",
      "tags": "finance,expansion",
      "created_days_ago": 3,
      "updated_days_ago": 1
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Mateo Alvarez",
      "contact_title": "Plant Systems Manager",
      "contact_email": "mateo.alvarez@acme.example",
      "contact_phone": "+1 312 555 0133",
      "source_name": "Cold Call",
      "stage_name": "Contacted",
      "status": "contacted",
      "score": 44,
      "deal_value": 24000,
      "notes": "Smaller workflow request for shop-floor exception routing. Good expansion path if the legal gate lands cleanly.",
      "tags": "operations,expansion",
      "created_days_ago": 21,
      "updated_days_ago": 8
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Grace Kim",
      "contact_title": "Customer Success Lead",
      "contact_email": "grace.kim@acme.example",
      "contact_phone": "+1 415 555 0114",
      "source_name": "Social Media",
      "stage_name": "Lost",
      "status": "unqualified",
      "score": 28,
      "deal_value": 18000,
      "notes": "Paused until Acme finishes its internal support tooling consolidation.",
      "tags": "paused,cs",
      "created_days_ago": 46,
      "updated_days_ago": 17
    },
    {
      "company_name": "Acme Industrial",
      "industry": "Manufacturing Operations",
      "website": "https://acme.example",
      "contact_name": "Iris Nguyen",
      "contact_title": "Procurement Manager",
      "contact_email": "iris.nguyen@acme.example",
      "contact_phone": "+1 415 555 0128",
      "source_name": "Website",
      "stage_name": "Closed Won",
      "status": "qualified",
      "score": 93,
      "deal_value": 98000,
      "notes": "Initial services package closed. Procurement wants all future expansion orders tied to approval audit events.",
      "tags": "procurement,closed-won",
      "created_days_ago": 64,
      "updated_days_ago": 11
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Marco Chen",
      "contact_title": "Head of Product",
      "contact_email": "marco@betacorp.example",
      "contact_phone": "+1 646 555 0120",
      "source_name": "Website",
      "stage_name": "Contacted",
      "status": "contacted",
      "score": 64,
      "deal_value": 42000,
      "notes": "Control customer for the feature-flag proof. BetaCorp keeps the standard CRM behavior while Acme gets the approval gate.",
      "tags": "control,standard-crm",
      "created_days_ago": 16,
      "updated_days_ago": 2
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Sarah Okafor",
      "contact_title": "VP Sales Strategy",
      "contact_email": "sarah.okafor@betacorp.example",
      "contact_phone": "+1 646 555 0144",
      "source_name": "Referral",
      "stage_name": "Proposal",
      "status": "qualified",
      "score": 86,
      "deal_value": 93000,
      "notes": "Wants regional pipeline views for forecast meetings. No legal approval gate should appear in the sales flow.",
      "tags": "forecast,regional-views",
      "created_days_ago": 23,
      "updated_days_ago": 1
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Helena Ruiz",
      "contact_title": "Compliance Lead",
      "contact_email": "helena.ruiz@betacorp.example",
      "contact_phone": "+1 646 555 0181",
      "source_name": "Trade Show",
      "stage_name": "Qualified",
      "status": "qualified",
      "score": 76,
      "deal_value": 71000,
      "notes": "Compliance team is reviewing field-level audit requirements for exportable forecast data.",
      "tags": "compliance,forecast-export",
      "created_days_ago": 12,
      "updated_days_ago": 4
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Ben Wallace",
      "contact_title": "CTO",
      "contact_email": "ben.wallace@betacorp.example",
      "contact_phone": "+1 646 555 0157",
      "source_name": "Referral",
      "stage_name": "Contract Sent",
      "status": "qualified",
      "score": 90,
      "deal_value": 132000,
      "notes": "Contract packet includes regional views as phase two. Technical approval is complete; finance sign-off remains.",
      "tags": "cto,contract",
      "created_days_ago": 38,
      "updated_days_ago": 5
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Jamie Lin",
      "contact_title": "Growth Operations Manager",
      "contact_email": "jamie.lin@betacorp.example",
      "contact_phone": "+1 646 555 0118",
      "source_name": "Email Campaign",
      "stage_name": "New Lead",
      "status": "new",
      "score": 49,
      "deal_value": 27000,
      "notes": "Interested in lightweight lead scoring, but budget is tied to next quarter planning.",
      "tags": "growth,new",
      "created_days_ago": 4,
      "updated_days_ago": 1
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Avery Brooks",
      "contact_title": "Implementation Owner",
      "contact_email": "avery.brooks@betacorp.example",
      "contact_phone": "+1 646 555 0199",
      "source_name": "Cold Call",
      "stage_name": "Contacted",
      "status": "contacted",
      "score": 55,
      "deal_value": 36000,
      "notes": "Needs a low-friction pilot plan for the retail banking group.",
      "tags": "implementation,pilot",
      "created_days_ago": 30,
      "updated_days_ago": 9
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Noah Stein",
      "contact_title": "Procurement Analyst",
      "contact_email": "noah.stein@betacorp.example",
      "contact_phone": "+1 646 555 0138",
      "source_name": "Social Media",
      "stage_name": "Lost",
      "status": "unqualified",
      "score": 31,
      "deal_value": 22000,
      "notes": "Not a fit until the wealth management team centralizes vendor approvals.",
      "tags": "paused,procurement",
      "created_days_ago": 55,
      "updated_days_ago": 20
    },
    {
      "company_name": "BetaCorp Financial",
      "industry": "Financial Services",
      "website": "https://betacorp.example",
      "contact_name": "Lena Foster",
      "contact_title": "Managing Director",
      "contact_email": "lena.foster@betacorp.example",
      "contact_phone": "+1 646 555 0106",
      "source_name": "Website",
      "stage_name": "Closed Won",
      "status": "qualified",
      "score": 94,
      "deal_value": 118000,
      "notes": "Closed initial analytics workspace. Regional pipeline reporting is the next expansion request.",
      "tags": "analytics,closed-won",
      "created_days_ago": 72,
      "updated_days_ago": 12
    }
  ]
  $json$::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lead_sources WHERE user_id = p_user_id) THEN
    INSERT INTO public.lead_sources (name, description, user_id) VALUES
      ('Website', 'Inbound demo and trial requests.', p_user_id),
      ('Referral', 'Introductions from customers, investors, and partners.', p_user_id),
      ('Social Media', 'LinkedIn, community, and founder-led social campaigns.', p_user_id),
      ('Cold Call', 'Outbound calls to target accounts.', p_user_id),
      ('Email Campaign', 'Lifecycle and event follow-up email programs.', p_user_id),
      ('Trade Show', 'Conference booth scans and field events.', p_user_id),
      ('Other', 'Manually sourced or imported records.', p_user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.lead_stages WHERE user_id = p_user_id) THEN
    INSERT INTO public.lead_stages (name, description, order_index, user_id) VALUES
      ('New Lead', 'Untriaged inbound or sourced lead.', 1, p_user_id),
      ('Contacted', 'Initial outreach completed and next step requested.', 2, p_user_id),
      ('Qualified', 'Need, authority, timeline, and value are validated.', 3, p_user_id),
      ('Proposal', 'Commercial proposal or implementation plan is under review.', 4, p_user_id),
      ('Contract Sent', 'Order form, MSA, or security packet is in contracting.', 5, p_user_id),
      ('Closed Won', 'Deal is won and ready for delivery or expansion tracking.', 6, p_user_id),
      ('Lost', 'Closed out or intentionally parked.', 7, p_user_id);
  END IF;

  PERFORM public.seed_forkable_demo(p_user_id);

  INSERT INTO public.clients (
    name,
    client_code,
    address,
    postal_code,
    country_code,
    user_id
  )
  SELECT *
  FROM (
    VALUES
      ('Acme Industrial', 'ACME', '525 Market Street, San Francisco, CA', '94105', 'US', p_user_id),
      ('BetaCorp Financial', 'BETA', '11 Madison Avenue, New York, NY', '10010', 'US', p_user_id)
  ) AS seeded(name, client_code, address, postal_code, country_code, user_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.clients existing
    WHERE existing.user_id = p_user_id
      AND existing.client_code = seeded.client_code
      AND existing.is_deleted = false
  );

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
    seeded.name,
    clients.id,
    'USD',
    current_date - seeded.started_days_ago,
    CASE
      WHEN seeded.ends_in_days IS NULL THEN NULL
      ELSE current_date + seeded.ends_in_days
    END,
    seeded.deal_status,
    seeded.billable,
    seeded.note,
    p_user_id
  FROM (
    VALUES
      ('Enterprise approval gate rollout', 'ACME', 34, 28, 'active', true, 'Legal Review gate for high-value deals and audit reporting.'),
      ('Implementation risk score discovery', 'ACME', 9, 45, 'active', true, 'Score large opportunities for security, legal, and integration readiness.'),
      ('Plant operations expansion', 'ACME', 68, NULL, 'on_hold', false, 'Paused until the first approval-gate release ships.'),
      ('Regional pipeline views', 'BETA', 18, 36, 'active', true, 'Forecast views split by North America, EMEA, and APAC.'),
      ('Quarterly forecast export', 'BETA', 6, 54, 'active', true, 'Finance-ready export with confidence notes and implementation owner.'),
      ('Analytics workspace launch', 'BETA', 91, -12, 'completed', true, 'Initial analytics workspace closed and handed to customer success.')
  ) AS seeded(name, client_code, started_days_ago, ends_in_days, deal_status, billable, note)
  JOIN public.clients clients
    ON clients.user_id = p_user_id
   AND clients.client_code = seeded.client_code
   AND clients.is_deleted = false
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.projects existing
    WHERE existing.user_id = p_user_id
      AND existing.client_id = clients.id
      AND existing.name = seeded.name
  );

  WITH demo_leads AS (
    SELECT *
    FROM jsonb_to_recordset(v_leads) AS lead_data(
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
      updated_days_ago integer
    )
  )
  UPDATE public.leads leads
  SET company_name = demo_leads.company_name,
      industry = demo_leads.industry,
      website = demo_leads.website,
      contact_name = demo_leads.contact_name,
      contact_title = demo_leads.contact_title,
      contact_phone = demo_leads.contact_phone,
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
  WHERE leads.user_id = p_user_id
    AND lower(leads.contact_email) = lower(demo_leads.contact_email);

  WITH demo_leads AS (
    SELECT *
    FROM jsonb_to_recordset(v_leads) AS lead_data(
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
      updated_days_ago integer
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
    'Seeded initial stage for the two-company demo pipeline.',
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

  WITH demo_contacts AS (
    SELECT contact_email
    FROM jsonb_to_recordset(v_leads) AS lead_data(contact_email text)
  ), demo_leads AS (
    SELECT
      leads.*,
      stages.name AS stage_name
    FROM public.leads leads
    JOIN demo_contacts ON lower(demo_contacts.contact_email) = lower(leads.contact_email)
    LEFT JOIN public.lead_stages stages ON stages.id = leads.current_stage_id
    WHERE leads.user_id = p_user_id
  ), generated_activities AS (
    SELECT
      id AS lead_id,
      'call' AS type,
      'Discovery call' AS subject,
      'Discussed current workflow, buying committee, and success criteria for ' || company_name || '.' AS description,
      created_at + interval '1 day' AS activity_date,
      30 AS duration_minutes,
      'completed' AS status
    FROM demo_leads
    UNION ALL
    SELECT
      id,
      'email',
      'Next steps recap',
      'Sent recap with decision owners, open questions, and the next milestone for the ' || coalesce(stage_name, status) || ' stage.',
      updated_at - interval '8 hours',
      NULL,
      'sent'
    FROM demo_leads
    UNION ALL
    SELECT
      id,
      'meeting',
      'Commercial review',
      'Reviewed scope, timeline, and implementation risk for the high-value opportunity.',
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

  WITH demo_contacts AS (
    SELECT contact_email
    FROM jsonb_to_recordset(v_leads) AS lead_data(contact_email text)
  ), demo_leads AS (
    SELECT
      leads.*,
      stages.name AS stage_name
    FROM public.leads leads
    JOIN demo_contacts ON lower(demo_contacts.contact_email) = lower(leads.contact_email)
    LEFT JOIN public.lead_stages stages ON stages.id = leads.current_stage_id
    WHERE leads.user_id = p_user_id
      AND leads.is_converted = false
  ), generated_follow_ups AS (
    SELECT
      id AS lead_id,
      CASE
        WHEN deal_value >= 100000 THEN now() + interval '1 day'
        WHEN stage_name IN ('Proposal', 'Contract Sent') THEN now() + interval '2 days'
        ELSE now() + interval '5 days'
      END AS due_date,
      CASE
        WHEN deal_value >= 100000 THEN 'high'
        WHEN stage_name IN ('Proposal', 'Contract Sent') THEN 'medium'
        ELSE 'low'
      END AS priority,
      'pending' AS status,
      CASE
        WHEN lower(company_name) LIKE 'acme%' THEN 'Confirm approval-owner coverage for ' || contact_name || '.'
        ELSE 'Confirm regional forecast requirements with ' || contact_name || '.'
      END AS description,
      NULL::timestamptz AS completed_at
    FROM demo_leads
    WHERE stage_name <> 'Lost'
    UNION ALL
    SELECT
      id,
      now() - interval '3 days',
      'medium',
      'completed',
      'Send stakeholder map and mutual action plan to ' || contact_name || '.',
      now() - interval '2 days'
    FROM demo_leads
    WHERE stage_name IN ('Qualified', 'Proposal', 'Contract Sent')
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
        ('iris.nguyen@acme.example', 'ACME', 98000::numeric, 'Converted after procurement accepted the initial services package.', 10),
        ('lena.foster@betacorp.example', 'BETA', 118000::numeric, 'Converted after analytics workspace sign-off.', 12)
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
        ('iris.nguyen@acme.example', 'ACME', 98000::numeric, 'Converted after procurement accepted the initial services package.', 10),
        ('lena.foster@betacorp.example', 'BETA', 118000::numeric, 'Converted after analytics workspace sign-off.', 12)
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

  WITH approval_seed AS (
    SELECT *
    FROM (
      VALUES
        ('nia.patel@acme.example', 'pending', 'Legal Review required for $120,000 enterprise deal.', NULL::integer),
        ('owen.mccarthy@acme.example', 'approved', 'Legal approved contract language for the enterprise approval workflow.', 2),
        ('priya.shah@acme.example', 'pending', 'RevOps requested legal sign-off before proposal advances.', NULL::integer)
    ) AS seeded(contact_email, status, reason, approved_days_ago)
  ), resolved AS (
    SELECT
      leads.id AS lead_id,
      leads.deal_value AS amount,
      approval_seed.status,
      approval_seed.reason,
      approval_seed.approved_days_ago
    FROM approval_seed
    JOIN public.leads leads
      ON leads.user_id = p_user_id
     AND lower(leads.contact_email) = lower(approval_seed.contact_email)
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
    resolved.lead_id,
    p_user_id,
    resolved.status,
    resolved.amount,
    resolved.reason,
    now() - interval '3 days',
    CASE
      WHEN resolved.status = 'approved' AND resolved.approved_days_ago IS NOT NULL
      THEN now() - (resolved.approved_days_ago * interval '1 day')
      ELSE NULL
    END,
    p_user_id
  FROM resolved
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.deal_approval_requests existing
    WHERE existing.lead_id = resolved.lead_id
      AND existing.user_id = p_user_id
      AND existing.status IN ('pending', 'approved')
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
  JOIN public.leads leads ON leads.id = requests.lead_id
  WHERE requests.user_id = p_user_id
    AND lower(leads.contact_email) IN (
      'nia.patel@acme.example',
      'owen.mccarthy@acme.example',
      'priya.shah@acme.example'
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
  JOIN public.leads leads ON leads.id = requests.lead_id
  WHERE requests.user_id = p_user_id
    AND lower(leads.contact_email) IN (
      'nia.patel@acme.example',
      'owen.mccarthy@acme.example',
      'priya.shah@acme.example'
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
    metadata,
    user_id,
    created_at
  )
  SELECT
    requests.id,
    requests.lead_id,
    'approval_approved',
    p_user_id,
    jsonb_build_object('amount', requests.amount),
    p_user_id,
    coalesce(requests.approved_at, now())
  FROM public.deal_approval_requests requests
  JOIN public.leads leads ON leads.id = requests.lead_id
  WHERE requests.user_id = p_user_id
    AND requests.status = 'approved'
    AND lower(leads.contact_email) = 'owen.mccarthy@acme.example'
    AND NOT EXISTS (
      SELECT 1
      FROM public.deal_approval_audit_events existing
      WHERE existing.approval_request_id = requests.id
        AND existing.user_id = p_user_id
        AND existing.event_type = 'approval_approved'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_forkable_demo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_crm_defaults(uuid) TO authenticated;

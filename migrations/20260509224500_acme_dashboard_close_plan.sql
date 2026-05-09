INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'acme_dashboard_close_plan',
  'Acme dashboard close plan',
  'Show Acme enterprise close-plan actions and require completion before late-stage advancement.'
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO public.company_feature_flags (
  company_account_id,
  feature_key,
  enabled,
  rollout_stage,
  notes,
  user_id
)
VALUES (
  'd63f23bf-3b09-4280-a60c-9ac1803bc9db',
  'acme_dashboard_close_plan',
  true,
  'preview',
  'Acme close-plan panel and enterprise-stage gate for request bcc9f705-83d0-4a8b-8f2d-064208a45da6.',
  'c1257023-ae1b-48e3-8ce4-f627490ab2b0'
)
ON CONFLICT (company_account_id, feature_key, user_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  rollout_stage = EXCLUDED.rollout_stage,
  notes = EXCLUDED.notes,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.acme_close_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acme_close_plan_items_action_key_check CHECK (
    action_key IN (
      'confirm_legal_owner',
      'attach_security_notes',
      'schedule_procurement_follow_up'
    )
  ),
  CONSTRAINT acme_close_plan_items_unique UNIQUE (lead_id, action_key, user_id)
);

CREATE INDEX IF NOT EXISTS acme_close_plan_items_lead_idx
  ON public.acme_close_plan_items (lead_id, user_id);

DROP TRIGGER IF EXISTS acme_close_plan_items_set_updated_at
  ON public.acme_close_plan_items;
CREATE TRIGGER acme_close_plan_items_set_updated_at
BEFORE UPDATE ON public.acme_close_plan_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE ON TABLE public.acme_close_plan_items TO authenticated;
ALTER TABLE public.acme_close_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_user_own_acme_close_plan_items"
  ON public.acme_close_plan_items;
CREATE POLICY "auth_user_own_acme_close_plan_items"
  ON public.acme_close_plan_items FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_acme_close_plan_items(
  p_lead_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  action_key text,
  completed_at timestamptz,
  completed_by uuid,
  notes text
)
LANGUAGE sql
STABLE
AS $$
  WITH required_actions(action_key) AS (
    VALUES
      ('confirm_legal_owner'),
      ('attach_security_notes'),
      ('schedule_procurement_follow_up')
  )
  SELECT
    required_actions.action_key,
    item.completed_at,
    item.completed_by,
    item.notes
  FROM required_actions
  JOIN public.leads lead
    ON lead.id = p_lead_id
   AND lead.user_id = p_user_id
  LEFT JOIN public.acme_close_plan_items item
    ON item.lead_id = lead.id
   AND item.user_id = p_user_id
   AND item.action_key = required_actions.action_key
  ORDER BY
    CASE required_actions.action_key
      WHEN 'confirm_legal_owner' THEN 1
      WHEN 'attach_security_notes' THEN 2
      WHEN 'schedule_procurement_follow_up' THEN 3
      ELSE 4
    END;
$$;

CREATE OR REPLACE FUNCTION public.complete_acme_close_plan_item(
  p_lead_id uuid,
  p_action_key text,
  p_user_id uuid DEFAULT auth.uid(),
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_feature_enabled boolean;
BEGIN
  IF p_action_key NOT IN (
    'confirm_legal_owner',
    'attach_security_notes',
    'schedule_procurement_follow_up'
  ) THEN
    RAISE EXCEPTION 'Unknown Acme close-plan action.';
  END IF;

  SELECT public.lead_has_feature_flag(p_lead_id, 'acme_dashboard_close_plan', p_user_id)
    INTO v_feature_enabled;

  IF NOT v_feature_enabled THEN
    RAISE EXCEPTION 'Acme close plan is not enabled for this company.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = p_lead_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Lead not found.';
  END IF;

  INSERT INTO public.acme_close_plan_items (
    lead_id,
    action_key,
    completed_at,
    completed_by,
    notes,
    user_id
  )
  VALUES (
    p_lead_id,
    p_action_key,
    now(),
    p_user_id,
    p_notes,
    p_user_id
  )
  ON CONFLICT (lead_id, action_key, user_id)
  DO UPDATE SET
    completed_at = EXCLUDED.completed_at,
    completed_by = EXCLUDED.completed_by,
    notes = EXCLUDED.notes,
    updated_at = now();

  INSERT INTO public.lead_activities (
    lead_id,
    type,
    subject,
    description,
    activity_date,
    status,
    user_id
  )
  VALUES (
    p_lead_id,
    'task',
    CASE p_action_key
      WHEN 'confirm_legal_owner' THEN 'Confirmed legal owner'
      WHEN 'attach_security_notes' THEN 'Attached security notes'
      WHEN 'schedule_procurement_follow_up' THEN 'Scheduled procurement follow-up'
    END,
    p_notes,
    now(),
    'completed',
    p_user_id
  );

  INSERT INTO public.deal_approval_audit_events (
    lead_id,
    event_type,
    actor_id,
    metadata,
    user_id
  )
  VALUES (
    p_lead_id,
    'acme_close_plan_item_completed',
    p_user_id,
    jsonb_build_object('action_key', p_action_key),
    p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_completed_acme_close_plan(
  p_lead_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('confirm_legal_owner'),
        ('attach_security_notes'),
        ('schedule_procurement_follow_up')
    ) AS required_actions(action_key)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.acme_close_plan_items item
      WHERE item.lead_id = p_lead_id
        AND item.user_id = p_user_id
        AND item.action_key = required_actions.action_key
        AND item.completed_at IS NOT NULL
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

  IF public.lead_has_feature_flag(p_lead_id, 'acme_dashboard_close_plan', p_user_id)
    AND v_deal_value >= 50000
    AND v_to_stage_name IN ('contract sent', 'closed won')
    AND NOT public.has_completed_acme_close_plan(p_lead_id, p_user_id)
  THEN
    RAISE EXCEPTION 'Complete Acme close-plan actions before advancing this enterprise deal.';
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

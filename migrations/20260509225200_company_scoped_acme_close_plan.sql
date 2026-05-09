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

  SELECT public.has_feature_flag('acme_dashboard_close_plan')
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

  IF public.has_feature_flag('acme_dashboard_close_plan')
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

GRANT EXECUTE ON FUNCTION public.complete_acme_close_plan_item(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage(uuid, uuid, uuid, text) TO authenticated;

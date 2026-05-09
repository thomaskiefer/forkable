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
    SELECT company_name, contact_email
    FROM public.leads
    WHERE id = p_lead_id
      AND user_id = p_user_id
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM target_lead lead
    JOIN public.customer_feature_flags flag
      ON flag.user_id = p_user_id
     AND flag.feature_key = p_feature_key
     AND flag.enabled = true
    LEFT JOIN public.change_requests request
      ON request.user_id = flag.user_id
     AND request.customer_email = flag.customer_email
     AND (
       request.feature_key = flag.feature_key
       OR request.feature_key IS NULL
     )
    WHERE lower(coalesce(lead.contact_email, '')) = lower(flag.customer_email)
       OR (
         request.customer_name IS NOT NULL
         AND lower(lead.company_name) LIKE lower(request.customer_name) || '%'
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.has_approved_legal_review(
  p_lead_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deal_approval_requests dar
    WHERE dar.lead_id = p_lead_id
      AND dar.user_id = p_user_id
      AND dar.status = 'approved'
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

GRANT EXECUTE ON FUNCTION public.lead_has_feature_flag(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_approved_legal_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_stage(uuid, uuid, uuid, text) TO authenticated;

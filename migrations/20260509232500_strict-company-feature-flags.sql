CREATE OR REPLACE FUNCTION public.has_feature_flag(p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.has_company_feature_flag(p_feature_key, auth.email(), auth.uid());
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
  SELECT
    EXISTS (
      SELECT 1
      FROM public.leads
      WHERE id = p_lead_id
        AND user_id = p_user_id
        AND p_user_id = auth.uid()
    )
    AND public.has_company_feature_flag(p_feature_key, auth.email(), auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.has_feature_flag(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_has_feature_flag(uuid, text, uuid) TO authenticated;

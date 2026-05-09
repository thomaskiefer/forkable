DROP FUNCTION IF EXISTS public.has_company_feature_flag(text, text, uuid);
DROP FUNCTION IF EXISTS public.has_feature_flag(text);
DROP FUNCTION IF EXISTS public.lead_has_feature_flag(uuid, text, uuid);

WITH grouped_flags AS (
  SELECT
    company_account_id,
    feature_key,
    user_id,
    bool_or(enabled) AS enabled,
    (array_agg(rollout_stage ORDER BY updated_at DESC, created_at DESC))[1] AS rollout_stage,
    (array_agg(notes ORDER BY updated_at DESC, created_at DESC))[1] AS notes,
    min(id::text)::uuid AS keep_id
  FROM public.company_feature_flags
  GROUP BY company_account_id, feature_key, user_id
)
UPDATE public.company_feature_flags flags
SET enabled = grouped_flags.enabled,
    rollout_stage = grouped_flags.rollout_stage,
    notes = grouped_flags.notes,
    updated_at = now()
FROM grouped_flags
WHERE flags.id = grouped_flags.keep_id;

WITH grouped_flags AS (
  SELECT min(id::text)::uuid AS keep_id, array_agg(id) AS ids
  FROM public.company_feature_flags
  GROUP BY company_account_id, feature_key, user_id
)
DELETE FROM public.company_feature_flags flags
USING grouped_flags
WHERE flags.id = ANY(grouped_flags.ids)
  AND flags.id <> grouped_flags.keep_id;

DROP INDEX IF EXISTS public.company_account_members_company_idx;

ALTER TABLE public.company_feature_flags
  DROP CONSTRAINT IF EXISTS company_feature_flags_team_not_blank,
  DROP CONSTRAINT IF EXISTS company_feature_flags_unique,
  DROP COLUMN IF EXISTS team_name,
  ADD CONSTRAINT company_feature_flags_unique UNIQUE (company_account_id, feature_key, user_id);

ALTER TABLE public.company_account_members
  DROP COLUMN IF EXISTS team_name;

ALTER TABLE public.customer_feature_flags
  DROP COLUMN IF EXISTS team_name;

CREATE INDEX IF NOT EXISTS company_account_members_company_idx
  ON public.company_account_members (company_account_id);

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

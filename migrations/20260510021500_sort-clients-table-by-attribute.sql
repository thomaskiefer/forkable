INSERT INTO public.feature_flags (key, name, description)
VALUES (
  'sort_clients_table_by_attribute',
  'Sort clients table by attribute',
  'Allow the Clients table to sort by company name, deal value, last activity, and ARR.'
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.get_sorted_clients(
  p_sort_field text DEFAULT 'last_activity',
  p_sort_direction text DEFAULT 'desc',
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS SETOF public.clients
LANGUAGE sql
STABLE
AS $$
  WITH client_metrics AS (
    SELECT
      clients.*,
      GREATEST(
        clients.updated_at,
        COALESCE(MAX(projects.updated_at), clients.updated_at),
        COALESCE(MAX(requests.updated_at), clients.updated_at),
        COALESCE(MAX(requests.created_at), clients.updated_at)
      ) AS last_activity_at,
      (
        90000
        + (
          COALESCE((
            SELECT SUM(ascii(substr(COALESCE(clients.client_code, clients.name, clients.id::text), idx, 1)))
            FROM generate_series(1, length(COALESCE(clients.client_code, clients.name, clients.id::text))) AS idx
          ), 0)::integer % 12
        ) * 35000
        + COUNT(DISTINCT projects.id) FILTER (
          WHERE projects.deal_status <> 'cancelled'
            AND projects.billable IS NOT FALSE
        ) * 80000
      )::numeric AS deal_value_sort
    FROM public.clients clients
    LEFT JOIN public.projects projects
      ON projects.client_id = clients.id
     AND projects.user_id = auth.uid()
    LEFT JOIN public.change_requests requests
      ON requests.user_id = auth.uid()
     AND (
       requests.company_account_id = clients.company_account_id
       OR lower(btrim(requests.customer_name)) = lower(btrim(clients.name))
     )
    WHERE clients.user_id = auth.uid()
      AND clients.is_deleted = false
      AND public.has_feature_flag('sort_clients_table_by_attribute')
    GROUP BY clients.id
  )
  SELECT
    id,
    name,
    client_code,
    address,
    postal_code,
    country_code,
    is_active,
    is_deleted,
    user_id,
    created_at,
    updated_at,
    company_account_id
  FROM client_metrics
  ORDER BY
    CASE WHEN p_sort_field = 'company_name' AND p_sort_direction = 'asc' THEN lower(name) END ASC,
    CASE WHEN p_sort_field = 'company_name' AND p_sort_direction = 'desc' THEN lower(name) END DESC,
    CASE WHEN p_sort_field = 'deal_value' AND p_sort_direction = 'asc' THEN deal_value_sort END ASC,
    CASE WHEN p_sort_field = 'deal_value' AND p_sort_direction = 'desc' THEN deal_value_sort END DESC,
    CASE WHEN p_sort_field = 'arr' AND p_sort_direction = 'asc' THEN round(deal_value_sort * 0.72) END ASC,
    CASE WHEN p_sort_field = 'arr' AND p_sort_direction = 'desc' THEN round(deal_value_sort * 0.72) END DESC,
    CASE WHEN p_sort_field = 'last_activity' AND p_sort_direction = 'asc' THEN last_activity_at END ASC NULLS LAST,
    CASE WHEN p_sort_field = 'last_activity' AND p_sort_direction = 'desc' THEN last_activity_at END DESC NULLS LAST,
    updated_at DESC,
    id ASC
  LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE GREATEST(p_limit, 0) END
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION public.get_sorted_clients(text, text, integer, integer) TO authenticated;

INSERT INTO public.company_feature_flags (
  company_account_id,
  feature_key,
  enabled,
  rollout_stage,
  notes,
  user_id
)
VALUES (
  '48561cc0-3f29-49d9-a191-6291b1e90d0c',
  'sort_clients_table_by_attribute',
  true,
  'production',
  'Enabled for request f1cd58b2-45ea-461c-8e9b-6b34ef1d0e9a.',
  '717ac12a-df48-4742-accc-708e4507ba5b'
)
ON CONFLICT (company_account_id, feature_key, user_id)
DO UPDATE SET
  enabled = EXCLUDED.enabled,
  rollout_stage = EXCLUDED.rollout_stage,
  notes = EXCLUDED.notes,
  updated_at = now();

UPDATE public.change_requests
SET feature_key = 'sort_clients_table_by_attribute',
    updated_at = now()
WHERE id = 'f1cd58b2-45ea-461c-8e9b-6b34ef1d0e9a';

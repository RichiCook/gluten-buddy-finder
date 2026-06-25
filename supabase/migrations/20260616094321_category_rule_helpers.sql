-- Mission Control "Rules" page: user-defined category re-classification.
-- The admin types a name pattern + a target category. Preview shows how many
-- products would move and a sample. Apply runs the actual UPDATE.

-- ────────────────────────────────────────────────────────────────────
-- preview_category_rule(pattern, target) — read-only sample
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_category_rule(
  name_pattern TEXT,
  target_category public.product_category
)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH matches AS (
    SELECT id, name, brand, category::text AS current_category
    FROM products
    WHERE name ILIKE '%' || name_pattern || '%'
      AND category != target_category
    ORDER BY name
    LIMIT 10
  ),
  total AS (
    SELECT COUNT(*) AS n FROM products
    WHERE name ILIKE '%' || name_pattern || '%'
      AND category != target_category
  ),
  by_cat AS (
    SELECT category::text AS category, COUNT(*) AS n
    FROM products
    WHERE name ILIKE '%' || name_pattern || '%'
      AND category != target_category
    GROUP BY category
    ORDER BY n DESC
  )
  SELECT json_build_object(
    'affected', (SELECT n FROM total),
    'from_categories', COALESCE((SELECT json_agg(by_cat) FROM by_cat), '[]'::json),
    'examples', COALESCE((SELECT json_agg(matches) FROM matches), '[]'::json)
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- apply_category_rule(pattern, target) — UPDATE; returns affected count
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_category_rule(
  name_pattern TEXT,
  target_category public.product_category
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE products
  SET category = target_category
  WHERE name ILIKE '%' || name_pattern || '%'
    AND category != target_category;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_category_rule(TEXT, public.product_category) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_category_rule(TEXT, public.product_category) TO authenticated;

-- Mission Control: dynamic category management.
-- Admins can add new values to the product_category enum at runtime.
--
-- Note on Postgres semantics: ALTER TYPE ADD VALUE works inside a function in
-- PG 12+ as long as the new value isn't used in the SAME transaction. Since
-- we return immediately after adding, this is safe.

-- ────────────────────────────────────────────────────────────────────
-- list_product_categories() — every enum value + product count
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_product_categories()
RETURNS TABLE(category TEXT, n BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH all_cats AS (
    SELECT unnest(enum_range(NULL::public.product_category))::text AS category
  ),
  counts AS (
    SELECT category::text AS category, COUNT(*)::bigint AS n
    FROM public.products
    GROUP BY category
  )
  SELECT a.category, COALESCE(c.n, 0)::bigint AS n
  FROM all_cats a
  LEFT JOIN counts c USING (category)
  ORDER BY a.category;
$$;

-- ────────────────────────────────────────────────────────────────────
-- add_product_category(new_name) — adds a value to the enum.
-- Validates: 2-40 chars, lowercase letters / digits / underscore / dash.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_product_category(new_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean TEXT;
BEGIN
  -- Normalize: lowercase, trim
  clean := LOWER(TRIM(new_name));

  -- Validate: 2-40 chars, only [a-z0-9_-]
  IF clean !~ '^[a-z0-9_-]{2,40}$' THEN
    RAISE EXCEPTION
      'Category name must be 2-40 characters: lowercase letters, digits, "_" or "-" only. Got: %', clean;
  END IF;

  -- Idempotent: ADD VALUE IF NOT EXISTS is safe to call repeatedly
  EXECUTE format(
    'ALTER TYPE public.product_category ADD VALUE IF NOT EXISTS %L',
    clean
  );

  RETURN clean;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_product_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_category(TEXT) TO authenticated;

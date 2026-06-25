-- Overload apply_category_rule to support per-row exclusions from the rules UI.
-- The 2-arg version stays for backward compatibility.

CREATE OR REPLACE FUNCTION public.apply_category_rule(
  name_pattern TEXT,
  target_category public.product_category,
  excluded_ids UUID[]
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
    AND category != target_category
    AND (excluded_ids IS NULL OR id <> ALL(excluded_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_category_rule(TEXT, public.product_category, UUID[]) TO authenticated;

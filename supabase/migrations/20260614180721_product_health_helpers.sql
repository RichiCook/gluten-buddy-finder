-- Mission Control: database-health helper functions.
-- Read-only metrics + three idempotent cleanup actions.

-- ────────────────────────────────────────────────────────────────────
-- product_health_metrics() — returns aggregate counts as JSON
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.product_health_metrics()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dup AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
      ORDER BY id
    ) AS rn
    FROM products
  ),
  cat AS (
    SELECT category::text AS category, COUNT(*)::int AS n
    FROM products
    GROUP BY category
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM products),
    'with_image', (SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND image_url != ''),
    'with_brand', (SELECT COUNT(*) FROM products WHERE brand IS NOT NULL AND brand != ''),
    'with_description', (SELECT COUNT(*) FROM products WHERE description IS NOT NULL AND description != ''),
    'with_tags', (SELECT COUNT(*) FROM products WHERE COALESCE(array_length(ingredient_tags, 1), 0) > 0),
    'junk', (
      SELECT COUNT(*) FROM products
      WHERE name ~* '\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|svg)$'
         OR name ~ '^IMG[_\-]'
         OR name ~ '^DSC[_\-]?[0-9]'
         OR name ~ '^DSCN[0-9]'
         OR name ~ '^P[0-9]{7}'
         OR name ~* '^https?://'
         OR LENGTH(TRIM(name)) < 3
         OR name ~ '^[0-9\s\-_.]+$'
         OR name ~ '^\s*$'
    ),
    'duplicate_rows', (SELECT COUNT(*) FROM dup WHERE rn > 1),
    'altro_count', (SELECT COUNT(*) FROM products WHERE category = 'altro'),
    'categories', (SELECT COALESCE(json_object_agg(category, n), '{}'::json) FROM cat)
  );
$$;

-- ────────────────────────────────────────────────────────────────────
-- cleanup_junk_products() — deletes rows whose name looks like garbage
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_junk_products()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  DELETE FROM products
  WHERE name ~* '\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|svg)$'
     OR name ~ '^IMG[_\-]'
     OR name ~ '^DSC[_\-]?[0-9]'
     OR name ~ '^DSCN[0-9]'
     OR name ~ '^P[0-9]{7}'
     OR name ~* '^https?://'
     OR LENGTH(TRIM(name)) < 3
     OR name ~ '^[0-9\s\-_.]+$'
     OR name ~ '^\s*$';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- cleanup_duplicate_products() — keeps the most complete row, deletes
-- duplicates by (lower(name), lower(brand)).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_duplicate_products()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
      ORDER BY
        (image_url IS NOT NULL)::int DESC,
        (description IS NOT NULL)::int DESC,
        COALESCE(array_length(ingredient_tags, 1), 0) DESC,
        created_at ASC
    ) AS rn
    FROM products
  )
  DELETE FROM products
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- backfill_product_categories() — re-classifies rows currently 'altro'
-- based on name patterns. Order matters: more specific first.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_product_categories()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total int := 0;
  step int;
BEGIN
  UPDATE products SET category = 'pasta' WHERE category = 'altro' AND (
    name ILIKE '%past%' OR name ILIKE '%spaghet%' OR name ILIKE '%rigaton%' OR
    name ILIKE '%fusill%' OR name ILIKE '%tagliatell%' OR name ILIKE '%lasagn%' OR
    name ILIKE '%maccheron%' OR name ILIKE '%penne%' OR name ILIKE '%farfall%' OR
    name ILIKE '%gnocch%' OR name ILIKE '%linguin%' OR name ILIKE '%conchigli%' OR
    name ILIKE '%orecchiett%' OR name ILIKE '%ravioli%' OR name ILIKE '%tortellin%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'biscotti' WHERE category = 'altro' AND (
    name ILIKE '%biscot%' OR name ILIKE '%frollin%' OR name ILIKE '%cookie%' OR
    name ILIKE '%wafer%' OR name ILIKE '%savoiard%' OR name ILIKE '%tarall%' OR
    name ILIKE '%krumir%' OR name ILIKE '%pavesin%' OR name ILIKE '%macine%' OR
    name ILIKE '%galletti%' OR name ILIKE '%gocciol%' OR name ILIKE '%baiocchi%' OR
    name ILIKE '%pan di stelle%' OR name ILIKE '%plasmon%' OR name ILIKE '%abbracci%' OR
    name ILIKE '%nascondini%' OR name ILIKE '%campagnol%' OR name ILIKE '%oro saiwa%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'pane' WHERE category = 'altro' AND (
    name ILIKE '%pane%' OR name ILIKE '%panin%' OR name ILIKE '%piadin%' OR
    name ILIKE '%baguette%' OR name ILIKE '%ciabatt%' OR name ILIKE '%grissin%' OR
    name ILIKE '%fette biscot%' OR name ILIKE '%toast%' OR name ILIKE '%bagel%' OR
    name ILIKE '%focacc%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'pizza' WHERE category = 'altro' AND (
    name ILIKE '%pizz%' OR name ILIKE '%base pizza%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'bevande' WHERE category = 'altro' AND (
    name ILIKE '%birr%' OR name ILIKE '% beer%' OR name ILIKE '%succo%' OR
    name ILIKE '%bevand%' OR name ILIKE '%coca-cola%' OR name ILIKE '%cola %' OR
    name ILIKE '%aperitiv%' OR name ILIKE '%spritz%' OR name ILIKE '%vino %' OR
    name ILIKE '%prosecco%' OR name ILIKE '%lager%' OR name ILIKE '%pilsner%' OR
    name ILIKE '%bibita%' OR name ILIKE '%aranciata%' OR name ILIKE '%chinotto%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'dolci' WHERE category = 'altro' AND (
    name ILIKE '%torta %' OR name ILIKE '%cake%' OR name ILIKE '%plumcake%' OR
    name ILIKE '%merendin%' OR name ILIKE '%muffin%' OR name ILIKE '%brioche%' OR
    name ILIKE '%bignè%' OR name ILIKE '%cannol%' OR name ILIKE '%tiramisu%' OR
    name ILIKE '%tiramisù%' OR name ILIKE '%panettone%' OR name ILIKE '%pandoro%' OR
    name ILIKE '%colomba%' OR name ILIKE '%budino%' OR name ILIKE '%dessert%' OR
    name ILIKE '%gelato%' OR name ILIKE '%cornetto%' OR name ILIKE '%pan di spagna%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'snack' WHERE category = 'altro' AND (
    name ILIKE '%snack%' OR name ILIKE '%patatin%' OR name ILIKE '%cracker%' OR
    name ILIKE '%pretzel%' OR name ILIKE '%popcorn%' OR name ILIKE '%pop corn%' OR
    name ILIKE '%tortilla%' OR name ILIKE '%nachos%' OR name ILIKE '%fonzies%' OR
    name ILIKE '%pringles%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'cereali' WHERE category = 'altro' AND (
    name ILIKE '%cereali%' OR name ILIKE '%fiocchi%' OR name ILIKE '%muesli%' OR
    name ILIKE '%granola%' OR name ILIKE '%avena%' OR name ILIKE '%corn flak%' OR
    name ILIKE '%porridge%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  UPDATE products SET category = 'farina' WHERE category = 'altro' AND (
    name ILIKE '%farin%' OR name ILIKE '%flour%' OR name ILIKE '%amido%' OR
    name ILIKE '%fecola%' OR name ILIKE '%lievito%' OR name ILIKE '%semola%'
  );
  GET DIAGNOSTICS step = ROW_COUNT; total := total + step;

  RETURN total;
END;
$$;

-- Grant execute to authenticated role (Mission Control calls them server-side
-- via service-role, but allowing authenticated keeps the policies tidy).
GRANT EXECUTE ON FUNCTION public.product_health_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_junk_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_duplicate_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_product_categories() TO authenticated;

-- ============================================================================
-- Gluten Baby — products table cleanup
-- ============================================================================
--
-- Run in Supabase Dashboard → SQL Editor.
--
-- Two-pass cleanup:
--   PASS 1 — remove junk rows (image filenames, URLs, garbage)
--   PASS 2 — remove duplicates, keeping the most complete copy
--
-- Each pass is split into PREVIEW (safe SELECT, run first) and APPLY
-- (the actual DELETE — uncomment ONLY after you've reviewed the preview).
--
-- Backup tip: if you want extra safety, create a snapshot of the products
-- table first:
--
--   CREATE TABLE products_backup_20260613 AS SELECT * FROM products;
--
-- ============================================================================
-- PASS 1 — JUNK ROWS
-- ============================================================================
--
-- Catches:
--   • names ending in an image extension (.jpg, .png, .webp, etc.)
--   • names that look like camera filenames (IMG_1234, DSC0001)
--   • names that are URLs
--   • names that are too short to be a product (< 3 chars)
--   • names that are just numbers
--   • names that are empty / whitespace
--
-- ----------------------------------------------------------------------------
-- 1A. PREVIEW — run this first
-- ----------------------------------------------------------------------------

SELECT
  id,
  brand,
  name,
  product_url
FROM public.products
WHERE
  name ~* '\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|svg)$'  -- image extension at end
  OR name ~ '^IMG[_\-]'                                    -- IMG_xxxx / IMG-xxxx
  OR name ~ '^DSC[_\-]?[0-9]'                              -- DSC0001
  OR name ~ '^DSCN[0-9]'                                   -- Nikon
  OR name ~ '^P[0-9]{7}'                                   -- Panasonic
  OR name ~* '^https?://'                                  -- URL
  OR LENGTH(TRIM(name)) < 3                                -- too short
  OR name ~ '^[0-9\s\-_.]+$'                               -- just numbers/separators
  OR name ~ '^\s*$'                                        -- blank
ORDER BY name
LIMIT 200;

-- Quick count of how many will be deleted:
SELECT COUNT(*) AS junk_to_delete
FROM public.products
WHERE
  name ~* '\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|svg)$'
  OR name ~ '^IMG[_\-]'
  OR name ~ '^DSC[_\-]?[0-9]'
  OR name ~ '^DSCN[0-9]'
  OR name ~ '^P[0-9]{7}'
  OR name ~* '^https?://'
  OR LENGTH(TRIM(name)) < 3
  OR name ~ '^[0-9\s\-_.]+$'
  OR name ~ '^\s*$';

-- ----------------------------------------------------------------------------
-- 1B. APPLY — uncomment after reviewing the preview above
-- ----------------------------------------------------------------------------

/*
DELETE FROM public.products
WHERE
  name ~* '\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|svg)$'
  OR name ~ '^IMG[_\-]'
  OR name ~ '^DSC[_\-]?[0-9]'
  OR name ~ '^DSCN[0-9]'
  OR name ~ '^P[0-9]{7}'
  OR name ~* '^https?://'
  OR LENGTH(TRIM(name)) < 3
  OR name ~ '^[0-9\s\-_.]+$'
  OR name ~ '^\s*$';
*/


-- ============================================================================
-- PASS 2 — DUPLICATES
-- ============================================================================
--
-- "Duplicate" = same lowercased+trimmed name + same lowercased+trimmed brand.
-- (Two products with the same name but different brand are NOT duplicates.)
--
-- When a duplicate set is found, we keep the row with the MOST data:
--   1. Has an image_url           (so the catalog card renders)
--   2. Has a description
--   3. Has more ingredient_tags
--   4. (tiebreaker) Oldest created_at
--
-- The rest are deleted.
--
-- ----------------------------------------------------------------------------
-- 2A. PREVIEW — how many duplicate sets, total duplicates to delete
-- ----------------------------------------------------------------------------

WITH ranked AS (
  SELECT
    id,
    LOWER(TRIM(name)) AS clean_name,
    LOWER(TRIM(COALESCE(brand, ''))) AS clean_brand,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
      ORDER BY
        (image_url IS NOT NULL)::int DESC,
        (description IS NOT NULL)::int DESC,
        COALESCE(array_length(ingredient_tags, 1), 0) DESC,
        created_at ASC
    ) AS rn,
    COUNT(*) OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
    ) AS group_size
  FROM public.products
)
SELECT
  COUNT(*) FILTER (WHERE group_size > 1 AND rn = 1) AS distinct_products_with_dupes,
  COUNT(*) FILTER (WHERE group_size > 1 AND rn > 1) AS duplicate_rows_to_delete
FROM ranked;

-- Show the 50 worst offenders (products with the most copies)
WITH ranked AS (
  SELECT
    LOWER(TRIM(name)) AS clean_name,
    LOWER(TRIM(COALESCE(brand, ''))) AS clean_brand,
    COUNT(*) AS copies
  FROM public.products
  GROUP BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
)
SELECT clean_brand, clean_name, copies
FROM ranked
WHERE copies > 1
ORDER BY copies DESC
LIMIT 50;

-- ----------------------------------------------------------------------------
-- 2B. APPLY — uncomment after reviewing the preview
-- ----------------------------------------------------------------------------

/*
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, '')))
      ORDER BY
        (image_url IS NOT NULL)::int DESC,
        (description IS NOT NULL)::int DESC,
        COALESCE(array_length(ingredient_tags, 1), 0) DESC,
        created_at ASC
    ) AS rn
  FROM public.products
)
DELETE FROM public.products
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
*/


-- ============================================================================
-- PASS 3 (optional) — add a unique index to prevent FUTURE duplicates
-- ============================================================================
--
-- Once cleaned, this index makes inserting a duplicate impossible (the
-- importer's existing dedupe-by-product_url stays as the first line of
-- defense; this is belt-and-suspenders for the rare case where the same
-- product appears under two URLs).
--
-- Uncomment after PASS 2 has been applied.
--
/*
CREATE UNIQUE INDEX IF NOT EXISTS products_name_brand_uniq
  ON public.products (LOWER(TRIM(name)), LOWER(TRIM(COALESCE(brand, ''))));
*/


-- ============================================================================
-- FINAL — report what's left
-- ============================================================================

SELECT
  COUNT(*) AS total_products,
  COUNT(*) FILTER (WHERE image_url IS NOT NULL) AS with_image,
  COUNT(*) FILTER (WHERE brand IS NOT NULL) AS with_brand,
  COUNT(DISTINCT category) AS distinct_categories
FROM public.products;

SELECT category, COUNT(*) AS n
FROM public.products
GROUP BY category
ORDER BY n DESC;

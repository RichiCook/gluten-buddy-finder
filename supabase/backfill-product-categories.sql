-- One-time backfill: re-classify products into the proper category enum
-- based on their name. Run this in Supabase Dashboard → SQL Editor.
--
-- The Excel import normalized most products to "altro" because the source
-- categories didn't exactly match our enum. This UPDATE inspects each
-- product's `name` and assigns the most likely category.
--
-- After this runs, the Sfoglia category filter works perfectly with simple
-- `category = X` queries — no smart-pattern fallback needed at runtime.
--
-- Safe to re-run: each UPDATE only touches rows where the category is
-- currently 'altro' (so manually-curated categories aren't overwritten).

BEGIN;

-- Order matters: more specific categories first, so "frollini al cioccolato"
-- becomes biscotti rather than dolci.

UPDATE public.products SET category = 'pasta' WHERE category = 'altro' AND (
  name ILIKE '%past%' OR name ILIKE '%spaghet%' OR name ILIKE '%rigaton%' OR
  name ILIKE '%fusill%' OR name ILIKE '%tagliatell%' OR name ILIKE '%lasagn%' OR
  name ILIKE '%maccheron%' OR name ILIKE '%penne%' OR name ILIKE '%farfall%' OR
  name ILIKE '%gnocch%' OR name ILIKE '%linguin%' OR name ILIKE '%conchigli%' OR
  name ILIKE '%orecchiett%' OR name ILIKE '%ravioli%' OR name ILIKE '%tortellin%'
);

UPDATE public.products SET category = 'biscotti' WHERE category = 'altro' AND (
  name ILIKE '%biscot%' OR name ILIKE '%frollin%' OR name ILIKE '%cookie%' OR
  name ILIKE '%wafer%' OR name ILIKE '%savoiard%' OR name ILIKE '%tarall%' OR
  name ILIKE '%krumir%' OR name ILIKE '%pavesin%' OR name ILIKE '%macine%' OR
  name ILIKE '%galletti%' OR name ILIKE '%gocciol%' OR name ILIKE '%baiocchi%' OR
  name ILIKE '%pan di stelle%' OR name ILIKE '%plasmon%' OR name ILIKE '%abbracci%' OR
  name ILIKE '%nascondini%' OR name ILIKE '%campagnol%' OR name ILIKE '%oroSaiwa%' OR
  name ILIKE '%oro saiwa%'
);

UPDATE public.products SET category = 'pane' WHERE category = 'altro' AND (
  name ILIKE '%pane%' OR name ILIKE '%panin%' OR name ILIKE '%piadin%' OR
  name ILIKE '%baguette%' OR name ILIKE '%ciabatt%' OR name ILIKE '%grissin%' OR
  name ILIKE '%fette biscot%' OR name ILIKE '%toast%' OR name ILIKE '%bagel%' OR
  name ILIKE '%focacc%'
);

UPDATE public.products SET category = 'pizza' WHERE category = 'altro' AND (
  name ILIKE '%pizz%' OR name ILIKE '%base pizza%'
);

UPDATE public.products SET category = 'bevande' WHERE category = 'altro' AND (
  name ILIKE '%birr%' OR name ILIKE '% beer%' OR name ILIKE '%succo%' OR
  name ILIKE '%bevand%' OR name ILIKE '%coca-cola%' OR name ILIKE '%cola %' OR
  name ILIKE '%aperitiv%' OR name ILIKE '%spritz%' OR name ILIKE '%vino %' OR
  name ILIKE '%champagne%' OR name ILIKE '%prosecco%' OR name ILIKE '%lager%' OR
  name ILIKE '%ipa %' OR name ILIKE '%pilsner%' OR name ILIKE '%bibita%' OR
  name ILIKE '%aranciata%' OR name ILIKE '%chinotto%'
);

UPDATE public.products SET category = 'dolci' WHERE category = 'altro' AND (
  name ILIKE '%torta %' OR name ILIKE '%cake%' OR name ILIKE '%plumcake%' OR
  name ILIKE '%merendin%' OR name ILIKE '%muffin%' OR name ILIKE '%brioche%' OR
  name ILIKE '%bignè%' OR name ILIKE '%cannol%' OR name ILIKE '%tiramisu%' OR
  name ILIKE '%tiramisù%' OR name ILIKE '%panettone%' OR name ILIKE '%pandoro%' OR
  name ILIKE '%colomba%' OR name ILIKE '%budino%' OR name ILIKE '%creme%' OR
  name ILIKE '%dessert%' OR name ILIKE '%gelato%' OR name ILIKE '%cornetto%' OR
  name ILIKE '%pan di spagna%'
);

UPDATE public.products SET category = 'snack' WHERE category = 'altro' AND (
  name ILIKE '%snack%' OR name ILIKE '%patatin%' OR name ILIKE '%cracker%' OR
  name ILIKE '%pretzel%' OR name ILIKE '%popcorn%' OR name ILIKE '%pop corn%' OR
  name ILIKE '%tortilla%' OR name ILIKE '%nachos%' OR name ILIKE '%fonzies%' OR
  name ILIKE '%pringles%'
);

UPDATE public.products SET category = 'cereali' WHERE category = 'altro' AND (
  name ILIKE '%cereali%' OR name ILIKE '%fiocchi%' OR name ILIKE '%muesli%' OR
  name ILIKE '%granola%' OR name ILIKE '%avena%' OR name ILIKE '%corn flak%' OR
  name ILIKE '%porridge%'
);

UPDATE public.products SET category = 'farina' WHERE category = 'altro' AND (
  name ILIKE '%farin%' OR name ILIKE '%flour%' OR name ILIKE '%amido%' OR
  name ILIKE '%fecola%' OR name ILIKE '%lievito%' OR name ILIKE '%semola%'
);

-- Report what changed
SELECT category, COUNT(*) AS n
FROM public.products
GROUP BY category
ORDER BY n DESC;

COMMIT;

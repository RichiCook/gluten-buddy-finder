-- Decodifica entità HTML nei nomi e descrizioni dei prodotti già salvati.
-- Gestisce &#x20; (hex), &#32; (decimale) e le entità nominate più comuni.

CREATE OR REPLACE FUNCTION public.decode_html_entities(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := input;
  m text;
BEGIN
  IF result IS NULL THEN
    RETURN NULL;
  END IF;

  -- Entità esadecimali &#xNN;
  LOOP
    m := substring(result from '&#[xX]([0-9A-Fa-f]+);');
    EXIT WHEN m IS NULL;
    result := regexp_replace(
      result,
      '&#[xX]' || m || ';',
      chr(('x' || lpad(m, 8, '0'))::bit(32)::int),
      'g'
    );
  END LOOP;

  -- Entità decimali &#NN;
  LOOP
    m := substring(result from '&#([0-9]+);');
    EXIT WHEN m IS NULL;
    result := regexp_replace(result, '&#' || m || ';', chr(m::int), 'g');
  END LOOP;

  -- Entità nominate comuni
  result := replace(result, '&nbsp;', ' ');
  result := replace(result, '&quot;', '"');
  result := replace(result, '&apos;', '''');
  result := replace(result, '&lt;', '<');
  result := replace(result, '&gt;', '>');
  result := replace(result, '&egrave;', 'è');
  result := replace(result, '&agrave;', 'à');
  result := replace(result, '&igrave;', 'ì');
  result := replace(result, '&ograve;', 'ò');
  result := replace(result, '&ugrave;', 'ù');
  -- &amp; per ultimo per evitare doppia decodifica
  result := replace(result, '&amp;', '&');

  RETURN result;
END;
$$;

UPDATE public.products
SET
  name = public.decode_html_entities(name),
  description = public.decode_html_entities(description),
  brand = public.decode_html_entities(brand)
WHERE
  name LIKE '%&#%' OR name LIKE '%&amp;%' OR name LIKE '%&nbsp;%'
  OR description LIKE '%&#%' OR description LIKE '%&amp;%' OR description LIKE '%&nbsp;%'
  OR brand LIKE '%&#%' OR brand LIKE '%&amp;%' OR brand LIKE '%&nbsp;%';
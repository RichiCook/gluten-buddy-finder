
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Make bucket non-public to avoid LIST, but keep object-level read via signed/public URLs
UPDATE storage.buckets SET public = false WHERE id = 'product-images';

DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;

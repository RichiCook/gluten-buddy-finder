-- AI feedback: admin-reported issues with recognize-image / match-products output.
-- Used to iteratively refine the AI prompt + matching logic.

CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  image_path TEXT,           -- storage path inside the 'ai-feedback' bucket; null if no photo
  ai_dish_name TEXT,         -- what the AI returned (if known)
  ai_summary TEXT,           -- free-form summary of what the AI suggested wrong
  expected_summary TEXT,     -- what the admin says the correct answer should be
  notes TEXT,                -- extra context / pattern observations
  kind TEXT NOT NULL DEFAULT 'mixed' CHECK (kind IN ('recognition', 'matching', 'mixed', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'addressed', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_feedback_status_idx ON public.ai_feedback (status, created_at DESC);

-- updated_at maintainer
CREATE OR REPLACE FUNCTION public.touch_ai_feedback_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_feedback_updated_at ON public.ai_feedback;
CREATE TRIGGER ai_feedback_updated_at
  BEFORE UPDATE ON public.ai_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ai_feedback_updated_at();

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read all feedback"
  ON public.ai_feedback FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins insert feedback"
  ON public.ai_feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins update feedback"
  ON public.ai_feedback FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins delete feedback"
  ON public.ai_feedback FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Private bucket for feedback photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('ai-feedback', 'ai-feedback', false)
ON CONFLICT (id) DO NOTHING;

-- Admin storage policies (object-level)
DROP POLICY IF EXISTS "Admins read feedback images" ON storage.objects;
CREATE POLICY "Admins read feedback images"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ai-feedback'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins upload feedback images" ON storage.objects;
CREATE POLICY "Admins upload feedback images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ai-feedback'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins delete feedback images" ON storage.objects;
CREATE POLICY "Admins delete feedback images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ai-feedback'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

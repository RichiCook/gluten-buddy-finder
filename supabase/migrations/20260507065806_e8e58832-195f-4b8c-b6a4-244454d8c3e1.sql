
-- Analytics events table
CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid DEFAULT NULL,
  country text,
  city text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_analytics_event_type ON public.analytics_events(event_type);
CREATE INDEX idx_analytics_product_id ON public.analytics_events(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_analytics_created_at ON public.analytics_events(created_at DESC);

-- Enable RLS
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Anyone (even anon) can insert events for tracking
CREATE POLICY "Anyone can insert analytics events"
  ON public.analytics_events FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Only admins can read events
CREATE POLICY "Admins can read analytics events"
  ON public.analytics_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Only admins can delete events
CREATE POLICY "Admins can delete analytics events"
  ON public.analytics_events FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

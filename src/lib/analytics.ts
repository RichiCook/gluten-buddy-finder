import { supabase } from "@/integrations/supabase/client";

type EventType = "scan" | "product_click" | "search" | "page_view";

export async function trackEvent(
  eventType: EventType,
  eventData: Record<string, any> = {},
  productId?: string,
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("analytics_events").insert({
      event_type: eventType,
      event_data: eventData,
      product_id: productId || null,
      user_id: user?.id || null,
      user_agent: navigator.userAgent,
    } as any);
  } catch {
    // silent – analytics should never break the app
  }
}

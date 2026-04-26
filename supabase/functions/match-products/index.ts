import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Ingredient {
  name: string;
  category: string;
  description?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { ingredients } = await req.json() as { ingredients: Ingredient[] };
    if (!Array.isArray(ingredients)) {
      return new Response(JSON.stringify({ error: "ingredients mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const matches = await Promise.all(
      ingredients.map(async (ing) => {
        // First try exact category + name LIKE
        const tokens = ing.name
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2);

        let { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("category", ing.category)
          .limit(20);

        if (error) {
          console.error("query error", error);
          data = [];
        }

        // Rank by simple token overlap on name+description+tags
        const ranked = (data || [])
          .map((p) => {
            const haystack = `${p.name} ${p.description || ""} ${
              (p.ingredient_tags || []).join(" ")
            }`.toLowerCase();
            const score = tokens.reduce(
              (s, t) => (haystack.includes(t) ? s + 1 : s),
              0,
            );
            return { ...p, _score: score };
          })
          .sort((a, b) => b._score - a._score)
          .slice(0, 8);

        return {
          ingredient: ing,
          products: ranked,
        };
      }),
    );

    return new Response(JSON.stringify({ matches }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-products error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

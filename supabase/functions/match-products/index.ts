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
  search_keywords?: string[];
}

// Categorie che esistono effettivamente nell'enum del DB
const DB_CATEGORIES = new Set([
  "pasta",
  "biscotti",
  "pane",
  "farina",
  "dolci",
  "snack",
  "cereali",
  "pizza",
  "altro",
]);

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
        // Costruisci le keyword di ricerca: search_keywords + nome + token nome
        const keywords = new Set<string>();
        (ing.search_keywords || []).forEach((k) =>
          k && keywords.add(k.toLowerCase().trim())
        );
        keywords.add(ing.name.toLowerCase().trim());
        ing.name
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2)
          .forEach((t) => keywords.add(t));

        const kwArr = Array.from(keywords).filter(Boolean);

        // 1) Cerca per keyword nel nome/descrizione/tags (su TUTTI i prodotti)
        //    Usa OR di ilike per ogni parola chiave
        const orFilters = kwArr.flatMap((k) => [
          `name.ilike.%${k}%`,
          `description.ilike.%${k}%`,
        ]).join(",");

        let candidates: any[] = [];

        if (orFilters) {
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .or(orFilters)
            .limit(60);
          if (error) console.error("keyword query error", error);
          else candidates = data || [];
        }

        // 2) Se la categoria esiste nel DB e abbiamo pochi risultati, aggiungi per categoria
        if (candidates.length < 8 && DB_CATEGORIES.has(ing.category)) {
          const { data: catData } = await supabase
            .from("products")
            .select("*")
            .eq("category", ing.category)
            .limit(20);
          (catData || []).forEach((p) => {
            if (!candidates.find((c) => c.id === p.id)) candidates.push(p);
          });
        }

        // Ranking per overlap delle keyword
        const ranked = candidates
          .map((p) => {
            const haystack = `${p.name} ${p.brand || ""} ${
              p.description || ""
            } ${(p.ingredient_tags || []).join(" ")}`.toLowerCase();
            const score = kwArr.reduce(
              (s, t) => (haystack.includes(t) ? s + 2 : s),
              0,
            ) + (DB_CATEGORIES.has(ing.category) && p.category === ing.category
              ? 1
              : 0);
            return { ...p, _score: score };
          })
          .filter((p) => p._score > 0)
          .sort((a, b) => b._score - a._score)
          .slice(0, 12);

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

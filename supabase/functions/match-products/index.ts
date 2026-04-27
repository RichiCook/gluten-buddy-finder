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
        // Keyword "principali" = nome ingrediente + search_keywords
        // Sono quelle che DEVONO matchare nel nome del prodotto
        const primaryKeywords = new Set<string>();
        const ingNameLower = ing.name.toLowerCase().trim();
        primaryKeywords.add(ingNameLower);
        (ing.search_keywords || []).forEach((k) => {
          const kk = k?.toLowerCase().trim();
          if (kk && kk.length > 2) primaryKeywords.add(kk);
        });
        // Aggiungi token significativi del nome (es. "pasta all'avena" -> "pasta", "avena")
        ingNameLower
          .split(/[\s'']+/)
          .filter((t) => t.length > 3)
          .forEach((t) => primaryKeywords.add(t));

        const primaryArr = Array.from(primaryKeywords).filter(Boolean);

        // 1) Cerca SOLO nel nome/brand prodotto per keyword principali
        const orFilters = primaryArr.flatMap((k) => [
          `name.ilike.%${k}%`,
          `brand.ilike.%${k}%`,
        ]).join(",");

        let candidates: any[] = [];

        if (orFilters) {
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .or(orFilters)
            .limit(80);
          if (error) console.error("keyword query error", error);
          else candidates = data || [];
        }

        // Ranking: forte priorità al match nel NOME del prodotto
        const ranked = candidates
          .map((p) => {
            const nameLower = (p.name || "").toLowerCase();
            const brandLower = (p.brand || "").toLowerCase();
            const descLower = (p.description || "").toLowerCase();
            const tagsLower = (p.ingredient_tags || []).join(" ").toLowerCase();

            let score = 0;
            for (const kw of primaryArr) {
              if (nameLower.includes(kw)) score += 10;       // forte
              else if (brandLower.includes(kw)) score += 4;
              else if (tagsLower.includes(kw)) score += 3;
              else if (descLower.includes(kw)) score += 1;
            }
            // Bonus se il nome ingrediente intero compare nel nome prodotto
            if (nameLower.includes(ingNameLower)) score += 6;
            // Piccolo bonus categoria coerente
            if (DB_CATEGORIES.has(ing.category) && p.category === ing.category) {
              score += 2;
            }
            return { ...p, _score: score };
          })
          // Soglia: scarta match deboli (solo descrizione o solo categoria)
          .filter((p) => p._score >= 6)
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

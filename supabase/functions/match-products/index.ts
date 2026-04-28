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

    // Termini "generici" che da soli non identificano un prodotto specifico:
    // se l'utente cerca "orecchiette" non vogliamo proporre tutti i tipi di pasta.
    const GENERIC_TERMS = new Set([
      "pasta", "biscotti", "biscotto", "pane", "farina", "dolci", "dolce",
      "snack", "cereali", "pizza", "cracker", "crackers", "grissini",
      "frollini", "frollino", "merendine", "merendina", "fette",
      "altro", "prodotto", "prodotti", "senza", "glutine", "lattosio",
    ]);

    // Genera varianti morfologiche italiane (singolare/plurale base)
    const morphVariants = (term: string): string[] => {
      const t = term.toLowerCase().trim();
      if (t.length < 4) return [t];
      const variants = new Set<string>([t]);
      if (t.endsWith("e")) variants.add(t.slice(0, -1) + "a");
      if (t.endsWith("i")) variants.add(t.slice(0, -1) + "o");
      if (t.endsWith("a")) variants.add(t.slice(0, -1) + "e");
      if (t.endsWith("o")) variants.add(t.slice(0, -1) + "i");
      return Array.from(variants);
    };

    const matches = await Promise.all(
      ingredients.map(async (ing) => {
        const ingNameLower = ing.name.toLowerCase().trim();

        // SPECIFIC keywords: nome ingrediente + search_keywords NON generiche.
        // Almeno una di queste DEVE comparire nel nome/brand del prodotto.
        const specificSet = new Set<string>();
        if (!GENERIC_TERMS.has(ingNameLower)) {
          morphVariants(ingNameLower).forEach((v) => specificSet.add(v));
        }
        ingNameLower
          .split(/[\s'']+/)
          .filter((t) => t.length > 3 && !GENERIC_TERMS.has(t))
          .forEach((t) => morphVariants(t).forEach((v) => specificSet.add(v)));
        (ing.search_keywords || []).forEach((k) => {
          const kk = k?.toLowerCase().trim();
          if (kk && kk.length > 2 && !GENERIC_TERMS.has(kk)) {
            morphVariants(kk).forEach((v) => specificSet.add(v));
          }
        });

        const specificArr = Array.from(specificSet).filter(Boolean);
        // Fallback: se l'ingrediente è solo un termine generico (es. "pasta"),
        // usa quel termine come unico criterio (comportamento precedente).
        const searchTerms = specificArr.length > 0 ? specificArr : [ingNameLower];

        const orFilters = searchTerms.flatMap((k) => [
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

        // Filtro stretto: il prodotto DEVE contenere uno dei termini specifici
        // nel name o brand, altrimenti viene scartato.
        const ranked = candidates
          .map((p) => {
            const nameLower = (p.name || "").toLowerCase();
            const brandLower = (p.brand || "").toLowerCase();

            let score = 0;
            let specificHit = false;
            for (const kw of searchTerms) {
              if (nameLower.includes(kw)) { score += 10; specificHit = true; }
              else if (brandLower.includes(kw)) { score += 4; specificHit = true; }
            }
            if (nameLower.includes(ingNameLower)) score += 6;
            if (DB_CATEGORIES.has(ing.category) && p.category === ing.category) {
              score += 2;
            }
            return { ...p, _score: score, _specificHit: specificHit };
          })
          .filter((p) => p._specificHit && p._score >= 10)
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

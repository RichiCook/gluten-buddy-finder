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
        const isGenericIngredient = GENERIC_TERMS.has(ingNameLower);

        // MANDATORY terms: il nome dell'ingrediente (e sue varianti morfologiche
        // dirette) DEVE comparire nel nome del prodotto. Le search_keywords NON
        // possono ammettere prodotti che non contengono il nome dell'ingrediente,
        // perchè spesso sono sinonimi ambigui (es. "cornetto" per "brioche" che
        // matcherebbe anche "cornetti di mais").
        const mandatorySet = new Set<string>();
        morphVariants(ingNameLower).forEach((v) => mandatorySet.add(v));
        // Aggiungi anche singole parole significative del nome (>3 char, non generiche)
        ingNameLower
          .split(/[\s'']+/)
          .filter((t) => t.length > 3 && !GENERIC_TERMS.has(t))
          .forEach((t) => morphVariants(t).forEach((v) => mandatorySet.add(v)));

        // Sinonimi per categoria: prodotti che sono dello stesso tipo ma non
        // contengono il termine esatto dell'ingrediente nel nome.
        const SYNONYM_TERMS: Record<string, string[]> = {
          cereali: ["corn flakes", "cornflakes", "fiocchi", "muesli", "granola", "anellini", "palline", "soffietti", "riso soffiato", "avena"],
          cereale: ["corn flakes", "cornflakes", "fiocchi", "muesli", "granola", "anellini", "palline", "soffietti", "riso soffiato", "avena"],
        };
        const synonyms = SYNONYM_TERMS[ingNameLower] || [];
        synonyms.forEach((s) => mandatorySet.add(s));

        const mandatoryTerms = Array.from(mandatorySet).filter(Boolean);

        // BOOST terms: search_keywords usate solo per dare punteggio extra,
        // non per ammettere prodotti.
        const boostSet = new Set<string>();
        (ing.search_keywords || []).forEach((k) => {
          const kk = k?.toLowerCase().trim();
          if (kk && kk.length > 2 && !GENERIC_TERMS.has(kk)) {
            morphVariants(kk).forEach((v) => boostSet.add(v));
          }
        });
        const boostTerms = Array.from(boostSet).filter(Boolean);

        // Per la query iniziale recuperiamo candidati che matchano i termini
        // obbligatori (per ingredienti generici come "pasta" usiamo il termine stesso).
        const queryTerms = mandatoryTerms.length > 0 ? mandatoryTerms : [ingNameLower];
        const orFilters = queryTerms.flatMap((k) => [
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

        // Filtro stretto: il prodotto DEVE contenere il NOME dell'ingrediente
        // (o una sua variante morfologica) nel name. Brand match conta solo se
        // il nome contiene anche il termine.
        const ranked = candidates
          .map((p) => {
            const nameLower = (p.name || "").toLowerCase();
            const brandLower = (p.brand || "").toLowerCase();

            let score = 0;
            let mandatoryHit = false;
            for (const kw of mandatoryTerms) {
              if (nameLower.includes(kw)) { score += 10; mandatoryHit = true; }
            }
            // Per ingredienti generici (es. "pasta") accettiamo anche match nel brand
            if (!mandatoryHit && isGenericIngredient) {
              for (const kw of queryTerms) {
                if (nameLower.includes(kw) || brandLower.includes(kw)) {
                  score += 8;
                  mandatoryHit = true;
                }
              }
            }
            // Boost terms aggiungono punti solo se già c'è un mandatory hit
            if (mandatoryHit) {
              for (const kw of boostTerms) {
                if (nameLower.includes(kw)) score += 2;
              }
            }
            if (DB_CATEGORIES.has(ing.category) && p.category === ing.category) {
              score += 2;
            }

            // ── Priorità prodotto finito vs preparato/farina ──
            // Quando l'ingrediente è un prodotto finito (es. "pane"),
            // premiamo i prodotti pronti e penalizziamo mix/farine/preparati.
            const READY_PRODUCT_TERMS: Record<string, { boost: RegExp; penalize: RegExp }> = {
              pane: {
                boost: /\b(pane|pancarr[eé]|fett[eai]\b|cassetta|sandwich|tramezzin|pan\s)/i,
                penalize: /\b(mix|preparato|preparati|farina|farine|lievito|impast)/i,
              },
              pizza: {
                boost: /\b(pizza|pizz[ae]|focaccia|base\s+pizza)/i,
                penalize: /\b(mix|preparato|preparati|farina|farine|lievito|impast)/i,
              },
              pasta: {
                boost: /\b(pasta|spaghet|pennett?[eai]|fusill|rigatoni|maccheroni|tagliatell|lasagn|gnocch)/i,
                penalize: /\b(mix|preparato|preparati|farina|farine|semola)/i,
              },
              cereali: {
                boost: /\b(cereali|fiocch|corn\s?flakes|muesli|granola|anellin|palline|soffiett)/i,
                penalize: /\b(pasta|spaghet|pennett?[eai]|fusill|rigatoni|maccheroni|tagliatell|lasagn|mafalda|multicereali|spaghetti)/i,
              },
            };
            const readyRule = READY_PRODUCT_TERMS[ingNameLower] ||
              (ing.category && READY_PRODUCT_TERMS[ing.category.toLowerCase()]);
            if (readyRule) {
              if (readyRule.boost.test(nameLower)) score += 15;
              if (readyRule.penalize.test(nameLower)) score -= 10;
            }

            return { ...p, _score: score, _mandatoryHit: mandatoryHit };
          })
          .filter((p) => p._mandatoryHit && p._score >= 8)
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

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Sei un assistente esperto di cibo italiano. Analizzi l'immagine di un prodotto alimentare o di un piatto e identifichi tutti gli ingredienti per cui un utente celiaco potrebbe voler cercare l'alternativa certificata senza glutine.

REGOLE:
1. Se l'immagine mostra un PRODOTTO confezionato singolo (birra, pasta, biscotti, pane, pizza), inserisci il prodotto STESSO come unico elemento.
   - Birra → [{ name: "birra", category: "bevande", search_keywords: ["birra"] }]
   - Pasta di grano → [{ name: "pasta", category: "pasta", search_keywords: ["pasta","spaghetti"] }]

2. Se l'immagine mostra un PIATTO COMPOSTO (es. tiramisù, lasagne, cheesecake, carbonara, parmigiana), DEVI elencare TUTTI gli ingredienti principali che lo compongono — sia quelli che contengono glutine sia quelli che normalmente NON ne contengono ma di cui esistono versioni certificate "senza glutine" (latticini, cacao, salse, creme, salumi, formaggi, uova). L'utente celiaco vuole vedere per ogni componente la versione certificata gluten-free.
   - Tiramisù → [
       { name: "savoiardi", category: "biscotti", search_keywords: ["savoiardi","biscotti"] },
       { name: "mascarpone", category: "altro", search_keywords: ["mascarpone"] },
       { name: "cacao", category: "altro", search_keywords: ["cacao"] },
       { name: "caffè", category: "bevande", search_keywords: ["caffè"] }
     ]
   - Lasagne → sfoglia lasagne, ragù, besciamella, parmigiano
   - Cheesecake → biscotti base, formaggio fresco, panna
   - Carbonara → spaghetti, guanciale, pecorino, uova

3. Non includere ingredienti banali (acqua, sale, olio, pepe, zucchero).

4. SOMIGLIANZA VISIVA: per OGNI ingrediente devi ANCHE descrivere le caratteristiche visive/formato del prodotto fotografato, in modo da poter trovare alternative senza glutine simili nell'aspetto. Esempi:
   - Foto di "Gocciole" Pavesi → visual_traits: ["gocce di cioccolato","gocce cioccolato","frollini","frollino","cioccolato","chocolate chips"]
   - Foto di "Pan di Stelle" Mulino Bianco → visual_traits: ["cacao","cocoa","nocciole","frollini","frollino","stelline","cioccolato"]
   - Foto di "Oro Saiwa" → visual_traits: ["frollini","frollino","classici","tondi"]
   - Foto di "Plumcake" → visual_traits: ["plumcake","soffice","merendina"]
   Usa parole italiane brevi (1-3 per trait), descrivi ingredienti visibili (gocce, cacao, nocciole, miele), forma (frollini, wafer, fette, tondi, stelle), tipologia (merendine, snack, biscotti secchi).

Rispondi SEMPRE chiamando lo strumento "report_food" con:
- dish_name: nome leggibile in italiano
- kind: "product" se prodotto singolo, "dish" se piatto composto
- gluten_ingredients: array degli ingredienti da cercare (vedi regole sopra), ognuno con:
   - name: nome breve in italiano
   - category: una di [pasta, biscotti, pane, farina, dolci, snack, cereali, pizza, bevande, altro]
   - search_keywords: 1-3 parole chiave per il database
   - visual_traits: array di tratti visivi/formato per matching estetico (vedi regola 4)
   - description: breve descrizione opzionale

Se non vedi alcun alimento, restituisci gluten_ingredients vuoto.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl) {
      return new Response(JSON.stringify({ error: "imageDataUrl mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY non configurata");

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analizza questa foto e identifica eventuali ingredienti con glutine.",
                },
                { type: "image_url", image_url: { url: imageDataUrl } },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "report_food",
                description: "Riporta cosa è stato riconosciuto nell'immagine.",
                parameters: {
                  type: "object",
                  properties: {
                    dish_name: { type: "string" },
                    kind: { type: "string", enum: ["product", "dish"] },
                    gluten_ingredients: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          category: {
                            type: "string",
                            enum: [
                              "pasta",
                              "biscotti",
                              "pane",
                              "farina",
                              "dolci",
                              "snack",
                              "cereali",
                              "pizza",
                              "bevande",
                              "altro",
                            ],
                          },
                          search_keywords: {
                            type: "array",
                            items: { type: "string" },
                          },
                          visual_traits: {
                            type: "array",
                            items: { type: "string" },
                          },
                          description: { type: "string" },
                        },
                        required: ["name", "category", "search_keywords", "visual_traits"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["dish_name", "kind", "gluten_ingredients"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "report_food" },
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({
            error: "Troppe richieste, riprova tra un momento.",
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({
            error:
              "Crediti AI esauriti. Aggiungi crediti al workspace Lovable.",
          }),
          {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI error ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(
        JSON.stringify({
          dish_name: "Non riconosciuto",
          kind: "product",
          gluten_ingredients: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const args = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recognize-image error:", e);
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

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Sei un assistente esperto di cibo italiano. Analizzi l'immagine di un prodotto alimentare o di un piatto e identifichi tutti gli elementi che TIPICAMENTE contengono glutine.

IMPORTANTE: se l'immagine mostra un PRODOTTO che di per sé contiene glutine (es. una birra, una pasta confezionata, dei biscotti, una pizza, del pane), DEVI inserire il prodotto STESSO come elemento glutinoso (così l'app può cercare alternative senza glutine equivalenti). Esempi:
- Foto di una birra → gluten_ingredients: [{ name: "birra", category: "bevande", search_keywords: ["birra"] }]
- Foto di pasta confezionata → gluten_ingredients: [{ name: "pasta di grano", category: "pasta", search_keywords: ["pasta","spaghetti"] }]
- Foto di un piatto di spaghetti al pomodoro → [{ name: "spaghetti", category: "pasta", search_keywords: ["spaghetti","pasta"] }]
- Foto di una pizza margherita → [{ name: "pizza", category: "pizza", search_keywords: ["pizza"] }]

Rispondi SEMPRE chiamando lo strumento "report_food" con:
- dish_name: nome leggibile del piatto/prodotto in italiano (es. "Birra Moretti Ricetta Originale", "Spaghetti alle vongole")
- kind: "product" se è un prodotto confezionato singolo, "dish" se è un piatto composto
- gluten_ingredients: array di elementi glutinosi (incluso il prodotto stesso se applicabile), ognuno con:
   - name: nome breve in italiano (es. "birra", "spaghetti", "biscotti", "pane")
   - category: una di [pasta, biscotti, pane, farina, dolci, snack, cereali, pizza, bevande, altro]
   - search_keywords: array di 1-3 parole chiave usate per cercare alternative senza glutine nel database (es. ["birra"], ["spaghetti","pasta"], ["pizza"])
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
                          description: { type: "string" },
                        },
                        required: ["name", "category", "search_keywords"],
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

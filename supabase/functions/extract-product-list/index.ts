import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { url, max = 20 } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = new URL(url);

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GlutenBabyBot/1.0; +https://glutenbaby.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) throw new Error(`Fetch fallito: ${resp.status}`);
    const html = await resp.text();

    // Extract all <a href="...">
    const links = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .filter((h) => h && !h.startsWith("#") && !h.startsWith("javascript:"));

    const absolute = uniq(
      links
        .map((h) => {
          try {
            return new URL(h, baseUrl).toString();
          } catch {
            return null;
          }
        })
        .filter((u): u is string => !!u),
    );

    // Heuristic: keep same-host product-like URLs
    const productLike = absolute.filter((u) => {
      try {
        const x = new URL(u);
        if (x.host !== baseUrl.host) return false;
        const path = x.pathname.toLowerCase();
        if (path === baseUrl.pathname) return false;
        return /\/(product|prodotto|prodotti|shop|store|p)\//.test(path) ||
          /\.html?$/.test(path) ||
          path.split("/").filter(Boolean).length >= 2;
      } catch {
        return false;
      }
    });

    const candidates = productLike.slice(0, max);

    // For each candidate, fetch and extract meta in parallel (with timeout)
    const results = await Promise.all(
      candidates.map(async (u) => {
        try {
          const c = await Promise.race([
            fetch(u, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; GlutenBabyBot/1.0)",
              },
            }),
            new Promise<Response>((_, rej) =>
              setTimeout(() => rej(new Error("timeout")), 8000)
            ),
          ]);
          if (!c.ok) return null;
          const h = await c.text();
          const name = h.match(
            /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
          )?.[1] ||
            h.match(/<title>([^<]+)<\/title>/i)?.[1] ||
            null;
          let image = h.match(
            /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
          )?.[1] || null;
          if (image && !image.startsWith("http")) {
            try {
              image = new URL(image, u).toString();
            } catch { /* ignore */ }
          }
          if (!name) return null;
          return { name: name.trim(), image, source_url: u };
        } catch {
          return null;
        }
      }),
    );

    const final = results.filter((r) => r !== null);
    return new Response(
      JSON.stringify({ candidates: final, total_links: candidates.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-product-list error:", e);
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

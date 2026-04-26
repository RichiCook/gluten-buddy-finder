import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function pickMeta(html: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractFromHtml(html: string, baseUrl: string) {
  // Try JSON-LD product first
  const ldMatches = [...html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];
  for (const m of ldMatches) {
    try {
      const json = JSON.parse(m[1].trim());
      const candidates = Array.isArray(json) ? json : [json];
      for (const node of candidates) {
        const items = node["@graph"] ? node["@graph"] : [node];
        for (const it of items) {
          if (it["@type"] === "Product" || it["@type"]?.includes?.("Product")) {
            const img = Array.isArray(it.image) ? it.image[0] : it.image;
            return {
              name: it.name || null,
              image: typeof img === "string" ? img : img?.url || null,
              description: it.description || null,
              brand:
                typeof it.brand === "string" ? it.brand : it.brand?.name || null,
            };
          }
        }
      }
    } catch (_) { /* ignore */ }
  }

  const name = pickMeta(html, [
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
    /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
    /<title>([^<]+)<\/title>/i,
  ]);
  let image = pickMeta(html, [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
  ]);
  const description = pickMeta(html, [
    /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
  ]);
  const brand = pickMeta(html, [
    /<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
  ]);

  if (image && !image.startsWith("http")) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch (_) { /* ignore */ }
  }

  return {
    name: name ? decodeHtml(name) : null,
    image,
    description: description ? decodeHtml(description) : null,
    brand: brand ? decodeHtml(brand) : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; GlutenBabyBot/1.0; +https://glutenbaby.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: `Fetch fallito: ${resp.status}` }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const html = await resp.text();
    const data = extractFromHtml(html, url);
    return new Response(JSON.stringify({ ...data, source_url: url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-product-url error:", e);
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

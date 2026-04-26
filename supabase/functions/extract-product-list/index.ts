import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function normalizeInputUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  if (/^tps?:\/\//i.test(trimmed)) return `ht${trimmed}`;
  if (/^ttps?:\/\//i.test(trimmed)) return `h${trimmed}`;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

// Extract product cards from common e-commerce listing markup (Magento, WooCommerce, Shopify, generic)
function extractProductCards(
  html: string,
  baseUrl: URL,
): { name: string; image: string | null; source_url: string }[] {
  const results: { name: string; image: string | null; source_url: string }[] =
    [];
  const seen = new Set<string>();

  // Pattern 1: Magento "product-item-link" anchors (used by farmacieglutenfree.it)
  const magentoRe =
    /<a[^>]+class=["'][^"']*product-item-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(magentoRe)) {
    pushCard(m[1], stripTags(m[2]));
  }
  // also reversed attribute order
  const magentoRe2 =
    /<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*product-item-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(magentoRe2)) {
    pushCard(m[1], stripTags(m[2]));
  }

  // Pattern 2: WooCommerce "woocommerce-LoopProduct-link"
  const wooRe =
    /<a[^>]+class=["'][^"']*woocommerce-LoopProduct-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(wooRe)) {
    const inner = m[2];
    const title = inner.match(
      /<h2[^>]*class=["'][^"']*woocommerce-loop-product__title[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i,
    )?.[1] || stripTags(inner);
    const img = inner.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1] ||
      null;
    pushCard(m[1], stripTags(title), img);
  }

  // Pattern 3: Generic product-item containers with image inside
  const itemRe =
    /<(?:li|div|article)[^>]+class=["'][^"']*(?:product-item|product-card|product\b)[^"']*["'][\s\S]*?<\/(?:li|div|article)>/gi;
  for (const block of html.match(itemRe) || []) {
    const link = block.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1];
    if (!link) continue;
    const title = block.match(
      /<a[^>]+class=["'][^"']*product-item-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    )?.[1] ||
      block.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i)?.[1] ||
      block.match(/alt=["']([^"']+)["']/i)?.[1];
    const img = block.match(
      /<img[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/i,
    )?.[1] || null;
    if (title) pushCard(link, stripTags(title), img);
  }

  function stripTags(s: string): string {
    return decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  function pushCard(href: string, name: string, image: string | null = null) {
    if (!name || name.length < 2) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const u = new URL(abs);
    if (u.host !== baseUrl.host) return;
    // skip non-product paths
    if (
      /\/(cart|checkout|wishlist|account|login|register|content|orders|customer|search)/i
        .test(u.pathname)
    ) return;
    if (u.pathname === baseUrl.pathname || u.pathname === "/") return;
    if (seen.has(abs)) return;
    seen.add(abs);
    let absImg: string | null = null;
    if (image) {
      try {
        absImg = new URL(image, baseUrl).toString();
      } catch { /* ignore */ }
    }
    results.push({ name, image: absImg, source_url: abs });
  }

  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, max = 100 } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = normalizeInputUrl(url);
    const baseUrl = new URL(normalized);

    const resp = await fetch(normalized, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });
    if (!resp.ok) throw new Error(`Fetch fallito: ${resp.status}`);
    const html = await resp.text();

    const cards = extractProductCards(html, baseUrl);

    // Fallback: if no cards found via specific patterns, do generic same-host links
    let finalCards = cards;
    if (cards.length === 0) {
      const links = uniq(
        [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
          .map((m) => m[1])
          .filter((h) =>
            h && !h.startsWith("#") && !h.startsWith("javascript:")
          )
          .map((h) => {
            try {
              return new URL(h, baseUrl).toString();
            } catch {
              return null;
            }
          })
          .filter((u): u is string => !!u),
      );
      finalCards = links
        .filter((u) => {
          const x = new URL(u);
          if (x.host !== baseUrl.host) return false;
          if (
            /\/(cart|checkout|wishlist|account|login|register|content|orders|customer|search)/i
              .test(x.pathname)
          ) return false;
          return x.pathname !== baseUrl.pathname && x.pathname !== "/";
        })
        .map((u) => ({ name: new URL(u).pathname.split("/").pop() || u, image: null, source_url: u }));
    }

    const candidates = finalCards.slice(0, max);

    return new Response(
      JSON.stringify({ candidates, total_links: candidates.length }),
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

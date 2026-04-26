import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
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

type Card = { name: string; image: string | null; source_url: string };

/**
 * Extract product cards by scanning anchors paired with the next image inside.
 * Works generically: looks for <a href="..."> ... <img src="..."> ... </a>
 * and falls back to the original card-extraction heuristics.
 */
function extractCards(html: string, baseUrl: URL): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();

  function push(href: string, name: string, image: string | null) {
    if (!name || name.length < 2) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const u = new URL(abs);
    if (u.host !== baseUrl.host) return;
    if (
      /\/(cart|checkout|wishlist|account|login|register|content|orders|customer|search|brands|categories?|tags?)\b/i
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
    out.push({ name, image: absImg, source_url: abs });
  }

  // Generic: anchor that wraps (or is followed by) an <img>. Allow large inner content for sites with long onclick handlers.
  const anchorImgRe =
    /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorImgRe)) {
    const href = m[1];
    const inner = m[2];
    if (inner.length > 5000) continue;
    const imgMatch = inner.match(
      /<img[^>]*?\b(?:data-src|data-original|data-lazy|src)=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["'][^>]*?(?:\balt=["']([^"']*)["'])?/i,
    );
    if (!imgMatch) continue;
    const image = imgMatch[1];
    if (/\/(logo|icon|placeholder|sprite|banner|menu|cashback|favicon|loader|spinner|brand)/i.test(image)) continue;

    // Try alt first, then alt placed BEFORE src in the same <img>
    let altName: string | undefined = imgMatch[2];
    if (!altName) {
      const altOnly = inner.match(/<img[^>]*\balt=["']([^"']+)["']/i);
      altName = altOnly?.[1];
    }
    const titleMatch = inner.match(/<(?:h\d|p|span|div)[^>]*>([\s\S]*?)<\/(?:h\d|p|span|div)>/i);
    const name = stripTags(altName || titleMatch?.[1] || "");
    push(href, name, image);
  }

  // Magento-specific fallback for the anchor without the wrapped image (image is sibling)
  const magentoRe =
    /<a[^>]+class=["'][^"']*product-item-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(magentoRe)) {
    push(m[1], stripTags(m[2]), null);
  }

  return out;
}

/** Extract data attributes from the listing page used for AJAX pagination (farmacieglutenfree-style sites). */
function extractAjaxState(html: string) {
  // <... id="allProductIds" data-value='[...]' data-tipo='...' ...>
  const m = html.match(
    /id=["']allProductIds["'][^>]*data-value=['"](\[[^'"]*\])['"][^>]*data-tipo=['"]([^'"]*)['"]/,
  ) ||
    html.match(
      /data-tipo=['"]([^'"]*)['"][^>]*id=["']allProductIds["'][^>]*data-value=['"](\[[^'"]*\])['"]/,
    );
  if (!m) return null;
  let idsRaw: string, tipo: string;
  if (m.length === 3 && m[1].startsWith("[")) {
    idsRaw = m[1];
    tipo = m[2];
  } else {
    tipo = m[1];
    idsRaw = m[2];
  }
  let allIds: string[] = [];
  try {
    allIds = JSON.parse(idsRaw);
  } catch {
    return null;
  }
  // already-rendered ids
  const loadedIds: string[] = [];
  for (const bp of html.matchAll(/class=["'][^"']*block-product[^"']*["'][^>]*data-value=['"](\d+)['"]/g)) {
    loadedIds.push(bp[1]);
  }
  for (const bp of html.matchAll(/data-value=['"](\d+)['"][^>]*class=["'][^"']*block-product[^"']*["']/g)) {
    loadedIds.push(bp[1]);
  }
  return { allIds, loadedIds, tipo };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, max = 1000 } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url mancante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = normalizeInputUrl(url);
    const baseUrl = new URL(normalized);

    // Initial fetch (capture cookies for session-based pagination)
    const resp = await fetch(normalized, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });
    if (!resp.ok) throw new Error(`Fetch fallito: ${resp.status}`);
    const html = await resp.text();

    // Capture cookies returned by the server for subsequent AJAX calls
    const setCookie = resp.headers.get("set-cookie") || "";
    const cookieHeader = setCookie
      .split(/,(?=[^;]+=[^;]+)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const cards: Card[] = extractCards(html, baseUrl);
    const ajax = extractAjaxState(html);

    // If the site uses the /products/more_product AJAX (farmacieglutenfree pattern), keep loading
    if (ajax && ajax.allIds.length > cards.length && cards.length > 0) {
      const moreUrl = new URL("/products/more_product", baseUrl).toString();
      const uniqueAll = Array.from(new Set(ajax.allIds));
      let loaded = ajax.loadedIds.length > 0
        ? ajax.loadedIds
        : uniqueAll.slice(0, cards.length);
      let safety = 0;
      while (
        loaded.length < uniqueAll.length &&
        cards.length < max &&
        safety < 50
      ) {
        safety++;
        const body = new URLSearchParams({
          loaded_ids: btoa(JSON.stringify(loaded)),
          all_ids: btoa(JSON.stringify(ajax.allIds)),
          order: "",
          tipo: ajax.tipo,
        }).toString();

        const r = await fetch(moreUrl, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: normalized,
            Cookie: cookieHeader,
            Accept: "*/*",
          },
          body,
        });
        if (!r.ok) {
          console.warn("more_product call failed", r.status);
          break;
        }
        const chunk = await r.text();
        const beforeCount = cards.length;
        const newCards = extractCards(chunk, baseUrl);
        for (const c of newCards) {
          if (!cards.find((x) => x.source_url === c.source_url)) {
            cards.push(c);
          }
        }
        // pull ids actually returned in this chunk
        const newIds: string[] = [];
        for (const bp of chunk.matchAll(/data-value=['"](\d+)['"]/g)) {
          newIds.push(bp[1]);
        }
        if (newIds.length === 0 && cards.length === beforeCount) {
          // No progress — stop to avoid infinite loop
          break;
        }
        loaded = loaded.concat(newIds);
      }
    }

    const candidates = cards.slice(0, max);

    return new Response(
      JSON.stringify({
        candidates,
        total_links: candidates.length,
        total_available: ajax?.allIds ? Array.from(new Set(ajax.allIds)).length : candidates.length,
      }),
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

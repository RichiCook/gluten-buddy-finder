import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Some sites (e.g. Esselunga) are Single-Page Apps that return an empty shell
// to normal browsers and only render product HTML server-side for search engine
// crawlers. Using Googlebot UA gives us the pre-rendered listing.
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// Hosts known to require Googlebot UA for SSR pre-rendered content.
const SSR_BOT_HOSTS = [
  "spesaonline.esselunga.it",
  "esselunga.it",
];

function needsBotUA(host: string): boolean {
  return SSR_BOT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

// Hosts known to be JS-rendered SPAs where direct HTML scraping yields nothing.
// For these, skip heavy probing and jump straight to the Firecrawl fallback.
const SPA_HOSTS = [
  "redcare.it",
  "www.redcare.it",
];

function isSpaHost(host: string): boolean {
  return SPA_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function decodeHtml(s: string): string {
  if (!s) return s;
  let out = s
    // Numeric hex entities: &#x20; &#xA0;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return _; }
    })
    // Numeric decimal entities: &#32; &#039;
    .replace(/&#(\d+);/g, (_, dec) => {
      try { return String.fromCodePoint(parseInt(dec, 10)); } catch { return _; }
    });
  // Named entities
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
    laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
    ndash: "–", mdash: "—", hellip: "…", trade: "™", copy: "©", reg: "®",
    egrave: "è", eacute: "é", agrave: "à", igrave: "ì", ograve: "ò", ugrave: "ù",
    Egrave: "È", Eacute: "É", Agrave: "À", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  };
  out = out.replace(/&([a-zA-Z]+);/g, (m, name) => named[name] ?? m);
  // Second pass for double-encoded entities (e.g., &amp;#x20;)
  if (/&(#x?\d+|[a-zA-Z]+);/.test(out) && out !== s) {
    return decodeHtml(out);
  }
  return out;
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
    // Allow same host OR sibling subdomains (e.g. us.example.com when base is it.example.com)
    if (u.host !== baseUrl.host) {
      const baseParts = baseUrl.host.split(".");
      const uParts = u.host.split(".");
      const baseParent = baseParts.slice(1).join(".");
      const uParent = uParts.slice(1).join(".");
      if (!baseParent || baseParent !== uParent) return;
    }
    if (
      /\/(cart|checkout|wishlist|account|my-account|login|register|content|orders|customer|search|brand|brands|categories?|tags?|manufacturer|cms|chi-siamo|about|faq|contatt|farmacie|volantino|blog|magazine|assistenza|resi|spedizion|privacy|cookie|terms|condizioni)\b/i
        .test(u.pathname)
    ) return;
    if (u.pathname === baseUrl.pathname || u.pathname === "/") return;
    // Skip PrestaShop category-style URLs: /xx/123-some-name (no intermediate path segment)
    // Real product URLs typically end with .html or have an intermediate segment like /xx/category/123-name.html
    if (/^\/[a-z]{2}\/\d+-[^/]+\/?$/i.test(u.pathname)) return;
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
  // Collect all anchors first for cross-referencing names when alt is empty
  const anchorsByHref = new Map<string, { images: string[]; names: string[] }>();
  const anchorMatches: { href: string; inner: string; tag: string }[] = [];
  for (const m of html.matchAll(anchorImgRe)) {
    const href = m[1];
    const inner = m[2];
    const tag = m[0].slice(0, m[0].indexOf(">") + 1); // opening <a ...> tag

    // For very large anchors (Shopware product-box-link style), extract name
    // from anchor title attribute and first image, then skip normal flow
    if (inner.length > 5000) {
      const titleAttr = tag.match(/\btitle=["']([^"']+)["']/i);
      if (titleAttr) {
        const name = decodeHtml(titleAttr[1]).trim();
        const imgM = inner.match(
          /<img[^>]*?\b(?:data-src|data-original|data-lazy|src)=["']([^"']+\.(?:jpe?g|png|webp|gif|imgix)[^"']*)["']/i,
        );
        let image: string | null = null;
        if (imgM && !/\/(logo|icon|placeholder|sprite|banner|menu|cashback|favicon|loader|spinner|brand)/i.test(imgM[1])) {
          image = decodeHtml(imgM[1]);
        }
        push(href, name, image);
      }
      continue;
    }
    anchorMatches.push({ href, inner, tag });
    if (!anchorsByHref.has(href)) anchorsByHref.set(href, { images: [], names: [] });
    const entry = anchorsByHref.get(href)!;
    // Collect images
    const imgM = inner.match(
      /<img[^>]*?\b(?:data-src|data-original|data-lazy|src)=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i,
    );
    if (imgM && !/\/(logo|icon|placeholder|sprite|banner|menu|cashback|favicon|loader|spinner|brand)/i.test(imgM[1])) {
      entry.images.push(imgM[1]);
    }
    // Collect names from headings inside anchor
    const hMatch = inner.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/i);
    if (hMatch) {
      const n = stripTags(hMatch[1]);
      if (n && n.length >= 3) entry.names.push(n);
    }
    // Collect names from plain-text anchors (e.g. <h3><a href="...">NAME</a></h3>)
    // These have no images and short inner HTML that is just the product name.
    if (!imgM && inner.length < 300 && !/<img\b/i.test(inner)) {
      const plainName = stripTags(inner);
      if (plainName && plainName.length >= 3 && plainName.length < 150) {
        entry.names.push(plainName);
      }
    }
    // Collect aria-label from anchor tag as name
    const ariaLabel = tag.match(/\baria-label=["']([^"']+)["']/i);
    if (ariaLabel) {
      const al = decodeHtml(ariaLabel[1]).trim();
      if (al && al.length >= 3) entry.names.push(al);
    }
  }

  for (const { href, inner, tag } of anchorMatches) {
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
    // Try aria-label on the anchor tag (common in Woodmart/WooCommerce themes)
    if (!altName) {
      const ariaLabel = tag.match(/\baria-label=["']([^"']+)["']/i);
      if (ariaLabel) altName = decodeHtml(ariaLabel[1]).trim();
    }
    const titleMatch = inner.match(/<(?:h\d|p|span|div)[^>]*>([\s\S]*?)<\/(?:h\d|p|span|div)>/i);
    let name = stripTags(altName || titleMatch?.[1] || "");

    // If name is still empty, look for a sibling anchor with the same href that has the product name
    if (!name || name.length < 3) {
      const sibling = anchorsByHref.get(href);
      if (sibling && sibling.names.length > 0) {
        name = sibling.names[0];
      }
    }

    push(href, name, image);
  }

  // Shopware-specific: <a class="product-box-link" href="..." title="Product Name">
  // These anchors are huge (10K+) and the generic regex fails on them due to nested </a> issues.
  const shopwareRe =
    /<a\b[^>]*\bclass=["'][^"']*product-box-link[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*\btitle=["']([^"']+)["'][^>]*>/gi;
  const shopwareRe2 =
    /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*\bclass=["'][^"']*product-box-link[^"']*["'][^>]*\btitle=["']([^"']+)["'][^>]*>/gi;
  for (const re of [shopwareRe, shopwareRe2]) {
    for (const m of html.matchAll(re)) {
      const href = m[1];
      const name = decodeHtml(m[2]).trim();
      // Try to find image near this anchor (next 3000 chars)
      const pos = m.index! + m[0].length;
      const slice = html.slice(pos, pos + 5000);
      const imgM = slice.match(
        /(?:data-src|data-original|src)=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i,
      );
      let image: string | null = null;
      if (imgM && !/\/(logo|icon|placeholder|sprite|banner|menu|cashback|favicon|loader|spinner|brand)/i.test(imgM[1])) {
        image = decodeHtml(imgM[1]);
      }
      push(href, name, image);
    }
  }

  // Magento-specific fallback for the anchor without the wrapped image (image is sibling)
  const magentoRe =
    /<a[^>]+class=["'][^"']*product-item-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(magentoRe)) {
    push(m[1], stripTags(m[2]), null);
  }

  // Tile-based fallback: anchors containing <h2>/<h3>/<h4> with product name (drmax, etc.)
  const tileNameRe =
    /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>[\s\S]*?<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>[\s\S]*?<\/a>/gi;
  for (const m of html.matchAll(tileNameRe)) {
    const href = m[1];
    const name = stripTags(m[2]);
    if (!name || name.length < 3) continue;
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imgNearby = html.match(
      new RegExp(`<a[^>]*href=["']${escapedHref}["'][^>]*>[\\s\\S]*?<img[^>]+src=["']([^"']+\\.(?:jpe?g|png|webp|gif)[^"']*)["']`, "i"),
    );
    push(href, name, imgNearby?.[1] || null);
  }

  return out;
}

/** Extract data attributes from the listing page used for AJAX pagination (farmacieglutenfree-style sites). */
function extractAjaxState(html: string) {
  // <... id="allProductIds" data-value='[...]'  (data-tipo is optional)
  // The attribute uses single quotes: data-value='["123","456",...]' — match either quote style
  const idsMatch = html.match(
    /id=["']allProductIds["'][^>]*?data-value='(\[[^']*\])'/,
  ) || html.match(
    /id=["']allProductIds["'][^>]*?data-value="(\[[^"]*\])"/,
  );
  if (!idsMatch) return null;
  let allIds: string[] = [];
  try {
    allIds = JSON.parse(idsMatch[1]);
  } catch {
    return null;
  }
  const tipoMatch = html.match(/id=["']allProductIds["'][^>]*?data-tipo=['"]([^'"]*)['"]/) ||
    html.match(/data-tipo=['"]([^'"]*)['"][^>]*id=["']allProductIds["']/);
  const tipo = tipoMatch?.[1] ?? "";
  return { allIds, tipo };
}

function extractPaginationUrls(html: string, baseUrl: URL): string[] {
  // Find the highest page number referenced in the HTML pagination block
  // Supports WordPress/WooCommerce (/page/N/) and Magento (?p=N).
  let maxPage = 1;
  let templateUrl: string | null = null;
  let templatePageNum = 0;
  let style: "path" | "query" = "path";

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const rawHref = decodeHtml(m[1]).trim();
    if (!rawHref) continue;
    let abs: string;
    try {
      abs = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }
    const u = new URL(abs);
    if (u.host !== baseUrl.host) continue;

    const pathMatch = u.pathname.match(/\/page\/(\d+)\/?$/i) ||
      u.pathname.match(/\/page\/(\d+)\//i);
    const queryP = u.searchParams.get("p");
    const queryPage = u.searchParams.get("page");
    let pageNum = 0;
    let curStyle: "path" | "query" = "path";
    let curParam: "p" | "page" = "p";
    if (pathMatch) {
      pageNum = Number(pathMatch[1]);
      curStyle = "path";
    } else if (queryPage && /^\d+$/.test(queryPage)) {
      pageNum = Number(queryPage);
      curStyle = "query";
      curParam = "page";
    } else if (queryP && /^\d+$/.test(queryP)) {
      pageNum = Number(queryP);
      curStyle = "query";
      curParam = "p";
    }
    if (!pageNum) continue;
    if (pageNum > maxPage) maxPage = pageNum;
    if (pageNum >= templatePageNum) {
      templatePageNum = pageNum;
      templateUrl = abs;
      style = curStyle;
      (extractPaginationUrls as any)._param = curParam;
    }
  }

  if (maxPage <= 1 || !templateUrl) return [];

  const param = (extractPaginationUrls as any)._param ?? "p";
  const urls: string[] = [];
  for (let i = 2; i <= maxPage; i++) {
    let next: string;
    if (style === "path") {
      next = templateUrl.replace(/\/page\/\d+\//i, `/page/${i}/`);
    } else {
      const u = new URL(templateUrl);
      u.searchParams.set(param, String(i));
      next = u.toString();
    }
    urls.push(next);
  }
  return urls;
}

/** Probe pagination pages sequentially. Tries common param names: ?page=N (PrestaShop), ?p=N (Magento). */
function buildProbePages(baseUrl: URL, maxProbe = 30, param: "page" | "p" = "p"): string[] {
  const urls: string[] = [];
  for (let i = 2; i <= maxProbe; i++) {
    const u = new URL(baseUrl.toString());
    u.searchParams.set(param, String(i));
    urls.push(u.toString());
  }
  return urls;
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

    const useBotUA = needsBotUA(baseUrl.host);
    const effectiveUA = useBotUA ? GOOGLEBOT_UA : UA;

    const resp = await fetch(normalized, {
      headers: {
        "User-Agent": effectiveUA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });

    // If the site blocks us (403/401/etc), set empty HTML so the Firecrawl
    // fallback further down can handle it instead of aborting everything.
    const fetchBlocked = !resp.ok;
    if (fetchBlocked) {
      console.log(`[extract-product-list] Direct fetch returned ${resp.status} for ${baseUrl.host}, will try Firecrawl fallback`);
    }
    const html = fetchBlocked ? "" : await resp.text();

    const setCookie = fetchBlocked ? "" : (resp.headers.get("set-cookie") || "");
    const cookieHeader = setCookie
      .split(/,(?=[^;]+=[^;]+)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const forceFallback = fetchBlocked || isSpaHost(baseUrl.host);
    let cards: Card[] = forceFallback ? [] : extractCards(html, baseUrl);
    const ajax = forceFallback ? null : extractAjaxState(html);

    // ===== Redcare.it (Algolia-backed search SPA) =====
    const isRedcare = /(^|\.)redcare\.\w+$/i.test(baseUrl.host);
    if (isRedcare) {
      try {
        // Extract Algolia credentials from the page HTML (or use known defaults)
        const appIdM = html.match(/algoliaApplicationId[\\"]+"?\s*:\s*[\\"]+"?([A-Z0-9]+)/);
        const apiKeyM = html.match(/algoliaApiKey[\\"]+"?\s*:\s*[\\"]+"?([a-f0-9]+)/);
        const appId = appIdM?.[1] || "58ECUELY50";
        const apiKey = apiKeyM?.[1] || "6706777b1652b0b3d519958312d1ffa1";

        // Detect locale from hostname (redcare.it -> IT_it, redcare.de -> DE_de, etc.)
        const tldMatch = baseUrl.host.match(/\.(\w+)$/);
        const tld = (tldMatch?.[1] || "it").toUpperCase();
        const locale = `${tld}_${tld.toLowerCase()}`;
        const indexName = `products_mktplc_prod_${locale}`;

        const searchQuery = baseUrl.searchParams.get("q") ||
          baseUrl.searchParams.get("query") || "senza glutine";

        const algoliaUrl = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${indexName}/query`;
        const hitsPerPage = 100;
        const rcCards: Card[] = [];
        const rcSeen = new Set<string>();
        let totalHits = 0;
        let page = 0;
        let nbPages = 1;

        while (page < nbPages && rcCards.length < max) {
          const ar = await fetch(algoliaUrl, {
            method: "POST",
            headers: {
              "X-Algolia-API-Key": apiKey,
              "X-Algolia-Application-Id": appId,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              params: `query=${encodeURIComponent(searchQuery)}&hitsPerPage=${hitsPerPage}&page=${page}`,
            }),
          });
          if (!ar.ok) {
            console.log(`[extract-product-list] Redcare Algolia error ${ar.status}`);
            break;
          }
          const data = await ar.json();
          if (page === 0) {
            totalHits = data.nbHits || 0;
            nbPages = Math.min(data.nbPages || 1, Math.ceil(max / hitsPerPage));
            console.log(`[extract-product-list] Redcare Algolia: nbHits=${totalHits} nbPages=${data.nbPages} fetching=${nbPages}`);
          }
          for (const hit of (data.hits || [])) {
            const deeplink = hit.deeplink;
            if (!deeplink) continue;
            const abs = new URL(deeplink, baseUrl.origin).toString();
            if (rcSeen.has(abs)) continue;
            rcSeen.add(abs);
            rcCards.push({
              name: hit.productName || hit.brandSearch || "",
              image: hit.image || null,
              source_url: abs,
            });
            if (rcCards.length >= max) break;
          }
          page++;
        }

        const candidates = rcCards.slice(0, max);
        console.log(`[extract-product-list] Redcare: ${candidates.length} products (of ${totalHits} total)`);
        if (candidates.length > 0) {
          return new Response(
            JSON.stringify({
              candidates,
              total_links: candidates.length,
              total_available: totalHits,
              source: "redcare",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch (err) {
        console.log(`[extract-product-list] Redcare Algolia failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Shopify search pages only return ~250 products max via HTML pagination.
    // Detect Shopify and use the JSON products API for collections, or the
    // search results JSON for search pages to get all products.
    const isShopify = /cdn\.shopify\.com/i.test(html) || /shopify-section/i.test(html.slice(0, 5000));
    if (isShopify) {
      const searchQuery = baseUrl.searchParams.get("q") || "";
      // Try to find a collection handle from the URL path
      const collectionMatch = baseUrl.pathname.match(/\/collections\/([^/?#]+)/);
      
      // Detect gluten-free related search and look for a matching collection
      const normQuery = searchQuery.toLowerCase().replace(/[*+]/g, " ").replace(/\s+/g, " ").trim();
      const isGlutenFreeSearch = /senza\s*glutine|gluten[\s-]*free/i.test(normQuery);
      
      let shopifyCards: Card[] = [];
      const shopifySeen = new Set<string>();
      
      const addShopifyProduct = (product: any) => {
        const handle = product.handle;
        const prodUrl = new URL(`/products/${handle}`, baseUrl.origin).toString();
        if (shopifySeen.has(prodUrl)) return;
        shopifySeen.add(prodUrl);
        let image: string | null = null;
        if (product.images && product.images.length > 0) {
          const img = product.images[0];
          image = typeof img === "string" ? img : img.src || null;
        } else if (product.image) {
          image = typeof product.image === "string" ? product.image : product.image.src || null;
        }
        shopifyCards.push({
          name: product.title || handle.replace(/-/g, " "),
          image,
          source_url: prodUrl,
        });
      };

      // Strategy 1: If it's a collection page, use collection products.json
      let collectionHandle = collectionMatch?.[1] || null;
      // Strategy 2: For gluten-free searches, try the known collection
      if (!collectionHandle && isGlutenFreeSearch) {
        // Probe for common gluten-free collection handles
        for (const tryHandle of ["gluten-free", "senza-glutine", "gluten-free-food"]) {
          try {
            const probe = await fetch(`${baseUrl.origin}/collections/${tryHandle}.json?page=1&limit=1`, {
              headers: { "User-Agent": UA, Accept: "application/json" },
            });
            if (probe.ok) {
              const pj = await probe.json();
              if (pj.collection && pj.collection.products_count > 0) {
                collectionHandle = tryHandle;
                console.log(`[extract-product-list] Shopify: found collection "${tryHandle}" with ${pj.collection.products_count} products`);
                break;
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (collectionHandle) {
        // Fetch all products from the collection via JSON API (250 per page)
        for (let page = 1; page <= 100 && shopifyCards.length < max; page++) {
          try {
            const jsonUrl = `${baseUrl.origin}/collections/${collectionHandle}/products.json?page=${page}&limit=250`;
            const jr = await fetch(jsonUrl, {
              headers: { "User-Agent": UA, Accept: "application/json" },
            });
            if (!jr.ok) break;
            const jd = await jr.json();
            const products = jd.products || [];
            if (products.length === 0) break;
            for (const p of products) addShopifyProduct(p);
            console.log(`[extract-product-list] Shopify collection page ${page}: +${products.length} (total ${shopifyCards.length})`);
            if (products.length < 250) break; // last page
          } catch { break; }
        }
      } else if (searchQuery) {
        // For search without a collection, use Shopify search with JSON
        // Shopify search is limited to ~250 results, but it's better than HTML scraping
        for (let page = 1; page <= 50 && shopifyCards.length < max; page++) {
          try {
            const searchUrl = `${baseUrl.origin}/search?type=product&q=${encodeURIComponent(searchQuery)}&page=${page}&view=json`;
            const sr = await fetch(searchUrl, {
              headers: { "User-Agent": UA, Accept: "text/html,application/json" },
            });
            if (!sr.ok) break;
            const text = await sr.text();
            // Try to parse as JSON first
            try {
              const sj = JSON.parse(text);
              const products = sj.products || sj.results || [];
              if (products.length === 0) break;
              for (const p of products) addShopifyProduct(p);
            } catch {
              // Fall back to HTML extraction
              const pageCards = extractCards(text, baseUrl);
              if (pageCards.length === 0) break;
              for (const c of pageCards) {
                if (!shopifySeen.has(c.source_url)) {
                  shopifySeen.add(c.source_url);
                  shopifyCards.push(c);
                }
              }
            }
            if (shopifyCards.length <= page * 18 * 0.5) break; // diminishing returns
          } catch { break; }
        }
      }

      if (shopifyCards.length > cards.length) {
        console.log(`[extract-product-list] Shopify JSON: ${shopifyCards.length} products (vs ${cards.length} from HTML)`);
        const candidates = shopifyCards.slice(0, max);
        return new Response(
          JSON.stringify({
            candidates,
            total_links: candidates.length,
            total_found_on_site: shopifyCards.length,
            source: "shopify",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ===== Esselunga (SPA pre-rendered for Googlebot) =====
    // The page returns up to 30 products. Pagination is `/ricerca/<query>/<n>`.
    // We detect products by looking for "Prodotto senza glutine" (the wheat-with-slash
    // icon alt text) and extract canonical PDP links.
    const isEsselunga = /esselunga\.it$/i.test(baseUrl.host) ||
      baseUrl.host.endsWith("esselunga.it");
    if (isEsselunga) {
      const seen = new Set<string>();
      const esselungaCards: Card[] = [];

      const parseEsselungaPage = (pageHtml: string) => {
        // Match each product block: id="..."  ...  /store/prodotto/<id>/<slug>"  ...  src="<img>"  ...  alt="<name>"
        // The "senza glutine" badge marker.
        const blockRe =
          /<div class="product\s+flex-md-row[^"]*"[^>]*>([\s\S]*?)(?=<div class="product\s+flex-md-row|<\/main>|<\/body>)/g;
        let m: RegExpExecArray | null;
        while ((m = blockRe.exec(pageHtml)) !== null) {
          const block = m[1];
          // Require the gluten-free badge image to be present in this block
          const isGlutenFree = /senza_glutine\.webp/i.test(block) ||
            /Prodotto senza glutine/i.test(block);
          if (!isGlutenFree) continue;
          const linkM = block.match(
            /href="(\/commerce\/nav\/supermercato\/store\/prodotto\/\d+\/[^"]+)"/,
          );
          if (!linkM) continue;
          const href = linkM[1];
          const abs = new URL(href, baseUrl).toString();
          if (seen.has(abs)) continue;
          // Image
          const imgM = block.match(
            /src="(https:\/\/images\.services\.esselunga\.it\/[^"]+)"/,
          );
          // Name from alt of product image (first occurrence) or from URL slug
          let name = "";
          const altM = block.match(
            /<img[^>]+src="https:\/\/images\.services\.esselunga\.it[^"]+"[^>]*alt="([^"]+)"/,
          );
          if (altM) name = altM[1];
          if (!name) {
            const slug = href.split("/").pop() || "";
            name = slug.replace(/-/g, " ");
          }
          seen.add(abs);
          esselungaCards.push({
            name: stripTags(name),
            image: imgM ? imgM[1] : null,
            source_url: abs,
          });
        }
      };

      parseEsselungaPage(html);

      // Total declared: "Risultati della ricerca (NNN)"
      const totalM = html.match(/Risultati della ricerca \((\d+)\)/i);
      const declaredTotal = totalM ? parseInt(totalM[1], 10) : null;

      // Build paginated URL: append "/<n>" to pathname (replacing existing trailing /<n> if any)
      const buildEsselungaPage = (n: number) => {
        const cleanPath = baseUrl.pathname.replace(/\/\d+\/?$/, "");
        const u = new URL(cleanPath + "/" + n, baseUrl.origin);
        return u.toString();
      };

      if (declaredTotal && declaredTotal > esselungaCards.length) {
        const pages = Math.min(50, Math.ceil(declaredTotal / 30));
        for (let p = 2; p <= pages && esselungaCards.length < max; p++) {
          try {
            const pr = await fetch(buildEsselungaPage(p), {
              headers: {
                "User-Agent": GOOGLEBOT_UA,
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "it-IT,it;q=0.9",
              },
            });
            if (!pr.ok) break;
            const ph = await pr.text();
            const before = esselungaCards.length;
            parseEsselungaPage(ph);
            if (esselungaCards.length === before) break; // no new items, stop
          } catch {
            break;
          }
        }
      }

      // Replace cards with Esselunga-specific results (skip generic + Prestashop)
      const candidates = esselungaCards.slice(0, max);
      return new Response(
        JSON.stringify({
          candidates,
          total_links: candidates.length,
          total_found_on_site: declaredTotal ?? candidates.length,
          source: "esselunga",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // ===== Koro Shop (Shopware-based) =====
    // The search page renders only ~7 products inline; the full result set
    // (e.g. 32 items) is served by the AJAX widget endpoint /widgets/search.
    // Each product is wrapped in <div class="card product-box ..."> with
    // <a class="product-box-link" href="..." title="..."> and <div class="product-name">.
    const isKoro = /(^|\.)koro-shop\.it$/i.test(baseUrl.host) ||
      /(^|\.)korodrogerie\./i.test(baseUrl.host);
    if (isKoro) {
      const seen = new Set<string>();
      const koroCards: Card[] = [];

      const parseKoroPage = (pageHtml: string) => {
        const blockRe =
          /<div class="card product-box[^"]*"[\s\S]*?(?=<div class="card product-box|<\/main>|<\/body>)/g;
        let m: RegExpExecArray | null;
        while ((m = blockRe.exec(pageHtml)) !== null) {
          const block = m[0];
          // Match anchor with href and title (any attribute order)
          const linkM = block.match(
            /<a\b[^>]*\bhref="([^"]+)"[^>]*\btitle="([^"]+)"[^>]*>/,
          );
          // Also try title before href
          const linkM2 = !linkM ? block.match(
            /<a\b[^>]*\btitle="([^"]+)"[^>]*\bhref="([^"]+)"[^>]*>/,
          ) : null;
          const href = linkM ? linkM[1] : linkM2 ? linkM2[2] : null;
          const titleFromAttr = linkM ? linkM[2] : linkM2 ? linkM2[1] : null;
          if (!href) continue;
          let abs: string;
          try {
            abs = new URL(href, baseUrl).toString();
          } catch {
            continue;
          }
          if (seen.has(abs)) continue;
          seen.add(abs);

          let name = titleFromAttr || "";
          if (!name) {
            const nameM = block.match(
              /<div class="product-name"[^>]*>([\s\S]*?)<\/div>/,
            );
            if (nameM) name = stripTags(nameM[1]).trim();
          }
          if (!name) {
            const titleM = block.match(/title="([^"]+)"/);
            if (titleM) name = titleM[1];
          }

          // Image: prefer the data-src/src in product-image-wrapper
          let image: string | null = null;
          const imgM = block.match(
            /<img[^>]+(?:data-src|src)="([^"]+)"[^>]*class="[^"]*product-image[^"]*"/,
          ) || block.match(/<img[^>]+(?:data-src|src)="(https?:[^"]+)"/);
          if (imgM) image = imgM[1];

          koroCards.push({
            name: stripTags(name),
            image,
            source_url: abs,
          });
        }
      };

      // 1) parse the inline HTML we already have
      parseKoroPage(html);

      // 2) fetch the AJAX widget for the full result set
      const searchParam = baseUrl.searchParams.get("search") || "";
      if (searchParam) {
        const widgetUrl = `${baseUrl.origin}/widgets/search?search=${
          encodeURIComponent(searchParam)
        }&p=1`;
        try {
          const wr = await fetch(widgetUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "text/html,application/xhtml+xml",
              "Accept-Language": "it-IT,it;q=0.9",
            },
          });
          if (wr.ok) {
            const wh = await wr.text();
            parseKoroPage(wh);

            // paginate further if there's a "next" page
            for (let p = 2; p <= 20 && koroCards.length < max; p++) {
              const nextUrl = `${baseUrl.origin}/widgets/search?search=${
                encodeURIComponent(searchParam)
              }&p=${p}`;
              try {
                const nr = await fetch(nextUrl, {
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
                    "X-Requested-With": "XMLHttpRequest",
                    Accept: "text/html,application/xhtml+xml",
                  },
                });
                if (!nr.ok) break;
                const nh = await nr.text();
                const before = koroCards.length;
                parseKoroPage(nh);
                if (koroCards.length === before) break;
              } catch {
                break;
              }
            }
          }
        } catch (e) {
          console.error("[koro] widget fetch failed", e);
        }
      }

      const candidates = koroCards.slice(0, max);
      console.log(`[extract-product-list] Koro: ${candidates.length} products`);
      return new Response(
        JSON.stringify({
          candidates,
          total_links: candidates.length,
          total_found_on_site: candidates.length,
          source: "koro-shop",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // ===== eFarma (Magento-based) =====
    // Each product is a <form ... class="product-item product ..."> containing
    // an <a class="product__link product__name" href="..."> with an <h2> name,
    // and a separate <a> wrapping the <img>. Pagination uses ?p=N.
    const isEfarma = /(^|\.)efarma\.com$/i.test(baseUrl.host) ||
      /catalogsearch-result-index|page-products/i.test(html.slice(0, 2000));
    if (isEfarma) {
      const seen = new Set<string>();
      const efarmaCards: Card[] = [];

      const parseEfarmaPage = (pageHtml: string) => {
        // Split on the product-item form opener
        const blockRe =
          /<form\b[^>]*\bclass="[^"]*product-item\s+product[^"]*"[\s\S]*?<\/form>/g;
        const matches = pageHtml.match(blockRe);
        if (!matches) return;
        for (const block of matches) {
          // Name link: <a class="... product__name ..." href="...">
          const linkM = block.match(
            /<a[^>]+class="[^"]*product__name[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
          );
          let href: string | null = null;
          let nameRaw = "";
          if (linkM) {
            href = linkM[1];
            nameRaw = linkM[2];
          } else {
            // fallback: any product__link
            const fb = block.match(
              /<a[^>]+class="[^"]*product__link[^"]*"[^>]+href="([^"]+)"/,
            );
            if (fb) href = fb[1];
          }
          if (!href) continue;
          let abs: string;
          try {
            abs = new URL(href, baseUrl).toString();
          } catch {
            continue;
          }
          if (seen.has(abs)) continue;
          seen.add(abs);

          // name from <h2> inside link, or from img alt
          let name = "";
          const h2 = nameRaw.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
          if (h2) name = stripTags(h2[1]).trim();
          if (!name) {
            const altM = block.match(/<img[^>]+alt="([^"]+)"/);
            if (altM) name = altM[1];
          }
          if (!name) continue;

          // image: prefer the main product <img src=...>
          let image: string | null = null;
          const imgM = block.match(
            /<img[^>]+src="(https?:\/\/[^"]+)"[^>]*alt="[^"]*"/,
          );
          if (imgM) image = imgM[1];

          efarmaCards.push({ name, image, source_url: abs });
        }
      };

      parseEfarmaPage(html);

      // Magento pagination usually only links to the next ~5 pages, not the
      // real last page, so we cannot rely on the highest visible "?p=N".
      // Strategy: keep paging until we get an empty page OR no new products.
      // Cap at 200 pages as safety. Re-fetch each page after the last one we
      // discovered, expanding our window dynamically.
      let p = 2;
      let consecutiveEmpty = 0;
      while (p <= 200 && efarmaCards.length < max) {
        const nextUrl = new URL(baseUrl.toString());
        nextUrl.searchParams.set("p", String(p));
        try {
          const nr = await fetch(nextUrl.toString(), {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml",
              "Accept-Language": "it-IT,it;q=0.9",
            },
          });
          if (!nr.ok) break;
          const nh = await nr.text();
          const before = efarmaCards.length;
          parseEfarmaPage(nh);
          if (efarmaCards.length === before) {
            consecutiveEmpty++;
            // give 2 chances in case a single page renders 0 cards
            if (consecutiveEmpty >= 2) break;
          } else {
            consecutiveEmpty = 0;
          }
          p++;
        } catch {
          break;
        }
      }
      const lastPage = p - 1;


      const drugMarkersEf = /\b(integrator\w*|compress\w*|capsul\w*|bustin\w*|sciropp\w*|gocce|flacon\w*|fial\w*|sublingual\w*|orosolubil\w*|spray|unguent\w*|pomat\w*|crema\b|gel\b|lozion\w*|deterg\w+|shampoo|balsamo|dentifric\w+|collutori\w*|sapon\w+|profum\w+|lacca|cosmetic\w*|farmac\w+|antibiotic\w+|analgesi\w+|antinfiamm\w+|antidolorif\w+|cerott\w+|garz\w+|siring\w+|termometr\w+|preservativ\w+|lubrificant\w+|repellent\w+|antizanzar\w+|abbronz\w+|doposole|pannolin\w+|assorbent\w+|salviett\w+|disinfettant\w+|antisettic\w+|cicatrizz\w+|colliri\w*|spazzolin\w+|nasal\w+|aerosol|inalator\w+|mascherin\w+)\b/i;
      const efBefore = efarmaCards.length;
      const efarmaFood = efarmaCards.filter((c) => !drugMarkersEf.test(c.name || ""));
      const candidates = efarmaFood.slice(0, max);
      console.log(`[extract-product-list] eFarma: ${candidates.length} products (lastPage=${lastPage}, filtered ${efBefore}->${efarmaFood.length})`);
      if (candidates.length > 0) {
        return new Response(
          JSON.stringify({
            candidates,
            total_links: candidates.length,
            total_found_on_site: candidates.length,
            source: "efarma",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ===== 1000farmacie.it (Algolia-backed search) =====
    // The site renders results client-side via Algolia. The Algolia search-only key
    // is public (exposed in window.env). We query Algolia directly and paginate
    // through every result, restricted to the food category to skip drugs.
    const is1000farmacie = /(^|\.)1000farmacie\.it$/i.test(baseUrl.host);
    if (is1000farmacie) {
      try {
        const appIdM = html.match(/"ALGOLIA_APPLICATION_ID"\s*:\s*"([^"]+)"/);
        const apiKeyM = html.match(/"ALGOLIA_SEARCH_API_KEY"\s*:\s*"([^"]+)"/);
        const appId = appIdM?.[1] || "HW3T8WVS73";
        const apiKey = apiKeyM?.[1] || "a44069a5116559934332f93aa82d91d8";

        const pathParts = baseUrl.pathname.split("/").filter(Boolean);
        const queryRaw = pathParts[0]?.toLowerCase() === "cerca"
          ? decodeURIComponent(pathParts.slice(1).join("/") || "")
          : decodeURIComponent(pathParts.join(" "));

        const algoliaUrl = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/Product/query`;
        const hitsPerPage = 100;
        const tfCards: Card[] = [];
        const seen = new Set<string>();
        let totalHits = 0;
        let page = 0;
        let nbPages = 1;

        while (page < nbPages && tfCards.length < max) {
          const params = new URLSearchParams({
            query: queryRaw,
            hitsPerPage: String(hitsPerPage),
            page: String(page),
            facetFilters: JSON.stringify([["top_level_category_names:Alimentazione"]]),
          });
          const ar = await fetch(algoliaUrl, {
            method: "POST",
            headers: {
              "X-Algolia-API-Key": apiKey,
              "X-Algolia-Application-Id": appId,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ params: params.toString() }),
          });
          if (!ar.ok) {
            console.log(`[extract-product-list] 1000farmacie Algolia error ${ar.status}`);
            break;
          }
          const data = await ar.json();
          if (page === 0) {
            totalHits = data.nbHits || 0;
            nbPages = Math.min(data.nbPages || 1, Math.ceil(max / hitsPerPage));
            console.log(`[extract-product-list] 1000farmacie Algolia: nbHits=${totalHits} nbPages=${data.nbPages} fetching=${nbPages}`);
          }
          for (const hit of (data.hits || [])) {
            const link = hit.link || (hit.slug ? `/${hit.slug}.html` : null);
            if (!link) continue;
            const abs = new URL(link, baseUrl).toString();
            if (seen.has(abs)) continue;
            seen.add(abs);
            tfCards.push({
              name: hit.display_name || hit.slug || "",
              image: hit.url_for_cover_image || null,
              source_url: abs,
            });
            if (tfCards.length >= max) break;
          }
          page++;
        }

        const candidates = tfCards.slice(0, max);
        console.log(`[extract-product-list] 1000farmacie: ${candidates.length} products (of ${totalHits} in Alimentazione)`);
        if (candidates.length > 0) {
          return new Response(
            JSON.stringify({
              candidates,
              total_links: candidates.length,
              total_available: totalHits,
              source: "1000farmacie",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch (err) {
        console.log(`[extract-product-list] 1000farmacie Algolia failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ===== macrolibrarsi.it (Vue SPA backed by /feed/s.php JSON endpoint) =====
    // The search page renders results client-side. The JSON feed returns numFound,
    // pages, pageLenght (24) and a results[] with id, title, url, prices, etc.
    const isMacrolibrarsi = /(^|\.)macrolibrarsi\.it$/i.test(baseUrl.host);
    if (isMacrolibrarsi) {
      try {
        // Extract the search query from ?search3=... (or fallback path)
        const searchTerm =
          baseUrl.searchParams.get("search3") ||
          baseUrl.searchParams.get("q") ||
          decodeURIComponent(baseUrl.pathname.split("/").filter(Boolean).join(" "));

        const mlCards: Card[] = [];
        const seenMl = new Set<string>();
        let numFound = 0;
        let totalPages = 1;
        let pageNum = 1;

        while (pageNum <= totalPages && mlCards.length < max) {
          const feedUrl = `https://www.macrolibrarsi.it/feed/s.php?q=${encodeURIComponent(searchTerm)}&pag=${pageNum}`;
          const fr = await fetch(feedUrl, {
            headers: {
              "Accept": "application/json, text/plain, */*",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              "Referer": baseUrl.toString(),
            },
          });
          if (!fr.ok) {
            console.log(`[extract-product-list] macrolibrarsi feed error ${fr.status} on page ${pageNum}`);
            break;
          }
          const data = await fr.json();
          if (pageNum === 1) {
            numFound = Number(data.numFound) || 0;
            totalPages = Number(data.pages) || 1;
            console.log(`[extract-product-list] macrolibrarsi: numFound=${numFound} pages=${totalPages} pageLenght=${data.pageLenght}`);
          }
          const results = Array.isArray(data.results) ? data.results : [];
          if (results.length === 0) break;
          for (const r of results) {
            if (r?.type && String(r.type).toLowerCase() !== "prodotto") continue;
            const link = r?.url;
            if (!link || typeof link !== "string") continue;
            if (seenMl.has(link)) continue;
            seenMl.add(link);
            const title = [r.title, r.subtitle].filter(Boolean).join(" - ");
            mlCards.push({
              name: title || r.title || "",
              image: r.image || r.cover || null,
              source_url: link,
            });
            if (mlCards.length >= max) break;
          }
          pageNum++;
        }

        const candidates = mlCards.slice(0, max);
        console.log(`[extract-product-list] macrolibrarsi: ${candidates.length} products (of ${numFound} total)`);
        if (candidates.length > 0) {
          return new Response(
            JSON.stringify({
              candidates,
              total_links: candidates.length,
              total_available: numFound,
              source: "macrolibrarsi",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } catch (err) {
        console.log(`[extract-product-list] macrolibrarsi feed failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ===== farmaciaguacci.it (OpenCart with embedded JS search widget) =====
    // The widget URL puts the query in the fragment (#...&q=...) which never reaches
    // the server. We bypass it and hit OpenCart's native search at
    // /index.php?route=product/search&search=...&page=N (12 products per page,
    // no visible pagination UI but ?page=N works server-side).
    const isFarmaciaguacci = /(^|\.)farmaciaguacci\.it$/i.test(baseUrl.host);
    if (isFarmaciaguacci) {
      try {
        let searchTerm =
          baseUrl.searchParams.get("q") ||
          baseUrl.searchParams.get("search") ||
          "";
        if (!searchTerm) {
          const hash = baseUrl.hash || "";
          const m = hash.match(/[?&#]q=([^&]+)/) || hash.match(/[?&#]search=([^&]+)/);
          if (m) searchTerm = decodeURIComponent(m[1].replace(/\+/g, " "));
        }

        if (searchTerm) {
          const fgCards: Card[] = [];
          const seenFg = new Set<string>();
          let pageNum = 1;
          let emptyStreak = 0;
          const maxPages = 200;

          // If the user is searching for gluten-free products, hit the dedicated
          // "Alimenti senza glutine" category (id 55) which contains ONLY food
          // products — no medicines, supplements or cosmetics. Otherwise, restrict
          // to the broader food category (id 45) using sub_category=true so we still
          // exclude pharmacy items.
          const normTerm = searchTerm.toLowerCase().replace(/\s+/g, " ").trim();
          const isGlutenFreeQuery = /senza\s*glutine|gluten[\s-]*free/.test(normTerm);
          const buildUrl = (p: number) =>
            isGlutenFreeQuery
              ? `https://farmaciaguacci.it/index.php?route=product/category&path=45_49_55&page=${p}`
              : `https://farmaciaguacci.it/index.php?route=product/search&search=${encodeURIComponent(searchTerm)}&category_id=45&sub_category=true&page=${p}`;

          while (pageNum <= maxPages && fgCards.length < max && emptyStreak < 2) {
            const searchUrl = buildUrl(pageNum);
            const fr = await fetch(searchUrl, {
              headers: { "User-Agent": UA, "Accept": "text/html" },
            });
            if (!fr.ok) {
              console.log(`[extract-product-list] farmaciaguacci page ${pageNum} HTTP ${fr.status}`);
              break;
            }
            const pageHtml = await fr.text();
            const cards = extractCards(pageHtml, new URL(searchUrl));
            let added = 0;
            for (const c of cards) {
              if (seenFg.has(c.source_url)) continue;
              seenFg.add(c.source_url);
              fgCards.push(c);
              added++;
              if (fgCards.length >= max) break;
            }
            console.log(`[extract-product-list] farmaciaguacci page ${pageNum} (mode=${isGlutenFreeQuery ? "cat55" : "search+cat45"}): +${added} (total ${fgCards.length})`);
            if (added === 0) emptyStreak++;
            else emptyStreak = 0;
            pageNum++;
          }


          if (fgCards.length > 0) {
            const candidates = fgCards.slice(0, max);
            return new Response(
              JSON.stringify({
                candidates,
                total_links: candidates.length,
                source: "farmaciaguacci",
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } else {
          console.log("[extract-product-list] farmaciaguacci: no search term found in URL");
        }
      } catch (err) {
        console.log(`[extract-product-list] farmaciaguacci failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // structured products + pagination metadata. Much more reliable than scraping HTML
    // (and bypasses Cloudflare HTML challenges that can fire on subsequent requests).
    const isPrestashop = /prestashop/i.test(html) ||
      /id=["']js-product-list["']/i.test(html) ||
      /data-controller=["']product["']/i.test(html);
    let prestashopTotal: number | null = null;

    // Build a clean XHR URL: keep only the category path; strip tracking/UI params
    // (e.g. resultsPerPage, _gl, gclid, gbraid) which can cause the server to return
    // HTML instead of JSON or to mis-paginate.
    const buildXhrUrl = (pageNum: number) => {
      const u = new URL(baseUrl.pathname, baseUrl.origin);
      u.searchParams.set("from-xhr", "1");
      u.searchParams.set("page", String(pageNum));
      return u.toString();
    };

    if (isPrestashop && cards.length < max) {
      try {
        const xhrCards: Card[] = [];
        const xhrSeen = new Set<string>();

        const ingestProducts = (products: any[]) => {
          for (const p of products || []) {
            const href = p?.url || p?.canonical_url || p?.link;
            const name = p?.name;
            const image = p?.cover?.large?.url || p?.cover?.medium_default?.url ||
              p?.cover?.bo_default?.url || p?.cover?.url || null;
            if (!href || !name) continue;
            let abs: string;
            try {
              abs = new URL(href, baseUrl).toString();
            } catch {
              continue;
            }
            const u = new URL(abs);
            if (u.host !== baseUrl.host) continue;
            if (xhrSeen.has(abs)) continue;
            xhrSeen.add(abs);
            xhrCards.push({ name: stripTags(String(name)), image, source_url: abs });
          }
        };

        // Fetch page 1 via XHR to learn pages_count
        const r1 = await fetch(buildXhrUrl(1), {
          headers: {
            "User-Agent": UA,
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json,text/javascript,*/*;q=0.01",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            Referer: normalized,
            Cookie: cookieHeader,
          },
        });
        if (r1.ok) {
          const j1 = await r1.json();
          const pagesCount = Number(j1?.pagination?.pages_count) || 1;
          prestashopTotal = Number(j1?.pagination?.total_items) || null;
          console.log(`[extract-product-list] PrestaShop XHR: pages_count=${pagesCount}, total_items=${prestashopTotal}`);
          ingestProducts(j1?.products);

          for (let p = 2; p <= pagesCount && cards.length < max; p++) {
            try {
              const rp = await fetch(buildXhrUrl(p), {
                headers: {
                  "User-Agent": UA,
                  "X-Requested-With": "XMLHttpRequest",
                  Accept: "application/json,text/javascript,*/*;q=0.01",
                  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
                  Referer: normalized,
                  Cookie: cookieHeader,
                },
              });
              if (!rp.ok) {
                console.warn(`[extract-product-list] PrestaShop XHR page ${p} failed: ${rp.status}`);
                continue;
              }
              const jp = await rp.json();
              const before = xhrCards.length;
              ingestProducts(jp?.products);
              console.log(`[extract-product-list] PrestaShop XHR page ${p}: +${xhrCards.length - before} (total ${xhrCards.length})`);
            } catch (err) {
              console.warn(`[extract-product-list] PrestaShop XHR page ${p} error:`, err);
            }
          }

          if (xhrCards.length > 0) {
            cards = xhrCards;
            console.log(`[extract-product-list] using PrestaShop XHR listing only: ${cards.length} cards`);
          }
        } else {
          console.warn(`[extract-product-list] PrestaShop XHR probe failed: ${r1.status}`);
        }
      } catch (err) {
        console.warn("[extract-product-list] PrestaShop XHR path error:", err);
      }
    }

    if (ajax && ajax.allIds.length > cards.length && cards.length > 0) {
      const moreUrl = new URL("/products/more_product", baseUrl).toString();
      const uniqueAll = Array.from(new Set(ajax.allIds));
      let loaded: string[] = uniqueAll.slice(0, cards.length);
      let safety = 0;
      console.log(`[extract-product-list] starting AJAX pagination: cards=${cards.length}, total unique=${uniqueAll.length}, tipo="${ajax.tipo}"`);

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
          console.warn(`[extract-product-list] more_product call ${safety} failed: ${r.status}`);
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

        const newIds = new Set<string>();
        const blockArr = chunk.match(/class=["']d-none block-product["'][^>]*data-value='(\[[^']*\])'/) ||
          chunk.match(/data-value='(\[[^']*\])'[^>]*class=["']d-none block-product["']/);
        if (blockArr) {
          try {
            const arr = JSON.parse(blockArr[1]);
            for (const id of arr) newIds.add(String(id));
          } catch { /* ignore */ }
        }
        for (const bp of chunk.matchAll(/data-value=['"](\d+)['"]/g)) {
          newIds.add(bp[1]);
        }
        const addedIds = [...newIds].filter((id) => !loaded.includes(id));
        console.log(`[extract-product-list] iter ${safety}: chunkBytes=${chunk.length} newCards=${cards.length - beforeCount} newIds=${addedIds.length} loadedTotal=${loaded.length + addedIds.length}/${uniqueAll.length}`);

        if (addedIds.length === 0 && cards.length === beforeCount) {
          const nextSlice = uniqueAll.slice(loaded.length, loaded.length + 40);
          if (nextSlice.length === 0) break;
          loaded = loaded.concat(nextSlice);
          continue;
        }
        loaded = loaded.concat(addedIds);
      }
    } else if (!isSpaHost(baseUrl.host)) {
      const paginationUrls = extractPaginationUrls(html, baseUrl);
      if (paginationUrls.length) {
        console.log(`[extract-product-list] following classic pagination: pages=${paginationUrls.length}`);
      }

      // Detect highest page number already in classic pagination, per param style.
      // Probe will resume from (highest+1) instead of restarting from 2 (which
      // would re-fetch already-seen pages and trigger immediate consecutiveEmpty).
      const highestSeen: { page: number; p: number } = { page: 1, p: 1 };
      for (const u of paginationUrls) {
        try {
          const uu = new URL(u);
          const qp = uu.searchParams.get("p");
          const qpage = uu.searchParams.get("page");
          if (qp && /^\d+$/.test(qp)) highestSeen.p = Math.max(highestSeen.p, Number(qp));
          if (qpage && /^\d+$/.test(qpage)) highestSeen.page = Math.max(highestSeen.page, Number(qpage));
        } catch { /* ignore */ }
      }

      // Magento exposes the real total count in the toolbar: data-amount="N".
      // WooCommerce exposes it as "Visualizzazione di X-Y di Z risultati".
      const totalAmountMatch = html.match(/data-amount=["'](\d+)["']/) ||
        html.match(/di\s+(\d+)\s+risultat/i) ||
        html.match(/of\s+(\d+)\s+results/i);
      const totalAmount = totalAmountMatch ? Number(totalAmountMatch[1]) : 0;
      let expectedLastPage = 0;
      if (totalAmount > 0 && cards.length > 0) {
        // Estimate items-per-page from the first page's card count (deduped).
        const perPage = Math.max(1, cards.length);
        expectedLastPage = Math.ceil(totalAmount / perPage);
        console.log(`[extract-product-list] toolbar total=${totalAmount} perPage~${perPage} expectedLastPage=${expectedLastPage}`);
      }

      // Fetch pagination pages in parallel batches to avoid timeout
      const BATCH_SIZE = 10;
      for (let i = 0; i < paginationUrls.length && cards.length < max; i += BATCH_SIZE) {
        const batch = paginationUrls.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(pageUrl =>
            fetch(pageUrl, {
              headers: {
                "User-Agent": effectiveUA,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
                Cookie: cookieHeader,
              },
            }).then(async (r) => {
              if (!r.ok) return [];
              const h = await r.text();
              return extractCards(h, baseUrl);
            })
          )
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            for (const c of r.value) {
              if (!cards.find((x) => x.source_url === c.source_url)) {
                cards.push(c);
              }
            }
          }
        }
      }

      // Probe pagination pages until two consecutive pages add no new products.
      // Try both ?page=N (PrestaShop) and ?p=N (Magento) param styles.
      // Skip if classic pagination already covered enough pages (e.g. WooCommerce /page/N/).
      const classicCoveredEnough = paginationUrls.length > 0 && totalAmount > 0 && cards.length >= totalAmount * 0.9;
      if (cards.length > 0 && cards.length < max && !classicCoveredEnough) {
        for (const probeParam of ["page", "p"] as const) {
          if (cards.length >= max) break;
          // Skip if base URL already has this param set (avoids re-fetching same page)
          if (baseUrl.searchParams.has(probeParam)) continue;
          // Resume probing from after the last page we already fetched via the
          // visible paginator. Magento only links to ~5 pages, but the real list
          // can have 20+ pages, so probing from p=2 would just hit duplicates.
          const startFrom = (highestSeen[probeParam] || 1) + 1;
          // Probe up to expectedLastPage or 150 pages, whichever
          // is larger — capped at 200 for safety.
          const upTo = Math.min(200, Math.max(150, expectedLastPage || 0));
          const probeUrls: string[] = [];
          for (let i = startFrom; i <= upTo; i++) {
            const u = new URL(baseUrl.toString());
            u.searchParams.set(probeParam, String(i));
            probeUrls.push(u.toString());
          }
          if (probeUrls.length === 0) continue;
          console.log(`[extract-product-list] probing ?${probeParam}=N pages (start, ${probeUrls.length} pages)`);
          // Probe in parallel batches
          let firstAdded = false;
          let stopProbing = false;
          for (let bi = 0; bi < probeUrls.length && !stopProbing && cards.length < max; bi += BATCH_SIZE) {
            const batch = probeUrls.slice(bi, bi + BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map(pageUrl =>
                fetch(pageUrl, {
                  headers: {
                    "User-Agent": effectiveUA,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
                    Cookie: cookieHeader,
                  },
                }).then(async (r) => {
                  if (!r.ok) return [];
                  const h = await r.text();
                  return extractCards(h, baseUrl);
                })
              )
            );
            let batchAdded = 0;
            for (const r of results) {
              if (r.status === "fulfilled") {
                for (const c of r.value) {
                  if (!cards.find((x) => x.source_url === c.source_url)) {
                    cards.push(c);
                    batchAdded++;
                  }
                }
              }
            }
            console.log(`[extract-product-list] probe batch ${bi / BATCH_SIZE + 1}: +${batchAdded} (total ${cards.length})`);
            if (batchAdded > 0) firstAdded = true;
            else if (firstAdded) stopProbing = true; // stop if a full batch adds nothing after we've seen results
          }
          // If this param style worked (added new products), don't try the other one
          if (firstAdded) break;
        }
      }

      // ===== Path-based /page/N/ probing (WooCommerce / WordPress) =====
      // If query-param probing didn't add products and we know total > found,
      // try WooCommerce-style /page/N/ path pagination.
      const isWooCommerce = /woocommerce/i.test(html.slice(0, 5000)) || /product_cat-/i.test(html);
      if (cards.length > 0 && cards.length < max && (isWooCommerce || expectedLastPage > 1)) {
        // Check if /page/N/ was already covered by classic pagination
        const alreadyHasPathPages = paginationUrls.some(u => /\/page\/\d+\//i.test(u));
        if (!alreadyHasPathPages) {
          const pathUpTo = Math.min(200, Math.max(expectedLastPage || 0, 150));
          if (pathUpTo > 1) {
            console.log(`[extract-product-list] probing /page/N/ path pagination (up to ${pathUpTo})`);
            let pathFirstAdded = false;
            let pathStopProbing = false;
            for (let bi = 2; bi <= pathUpTo && !pathStopProbing && cards.length < max; bi += BATCH_SIZE) {
              const batch: string[] = [];
              for (let p = bi; p < bi + BATCH_SIZE && p <= pathUpTo; p++) {
                const cleanPath = baseUrl.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
                batch.push(new URL(`${cleanPath}/page/${p}/`, baseUrl.origin).toString());
              }
              const results = await Promise.allSettled(
                batch.map(pageUrl =>
                  fetch(pageUrl, {
                    headers: {
                      "User-Agent": effectiveUA,
                      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
                      Cookie: cookieHeader,
                    },
                  }).then(async (r) => {
                    if (!r.ok) return [];
                    const h = await r.text();
                    return extractCards(h, baseUrl);
                  })
                )
              );
              let batchAdded = 0;
              for (const r of results) {
                if (r.status === "fulfilled") {
                  for (const c of r.value) {
                    if (!cards.find((x) => x.source_url === c.source_url)) {
                      cards.push(c);
                      batchAdded++;
                    }
                  }
                }
              }
              console.log(`[extract-product-list] path probe batch ${Math.floor((bi - 2) / BATCH_SIZE) + 1}: +${batchAdded} (total ${cards.length})`);
              if (batchAdded > 0) pathFirstAdded = true;
              else if (pathFirstAdded) pathStopProbing = true;
            }
          }
        }
      }
    }

    // ===== Firecrawl fallback for SPA / JS-rendered sites =====
    // If we found no candidates from the raw HTML (typical for Next.js / React SPA
    // sites like benufarma.it, or anti-bot sites like drmax.it), retry with Firecrawl.
    if (cards.length === 0) {
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (firecrawlKey) {
        console.log(`[extract-product-list] no cards from raw HTML, trying Firecrawl fallback for ${normalized}`);

        const fcSeen = new Set<string>();
        const fcAllCards: Card[] = [];

        const scrapePage = async (pageUrl: string): Promise<{ cards: Card[]; totalHint: number }> => {
          const fcResp = await fetch("https://api.firecrawl.dev/v2/scrape", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: pageUrl,
              formats: ["html", "links"],
              onlyMainContent: false,
              waitFor: 3500,
              location: { country: "IT", languages: ["it-IT", "it"] },
            }),
          });
          const fcData = await fcResp.json().catch(() => null);
          if (!fcResp.ok || !fcData) {
            console.log(`[extract-product-list] Firecrawl error ${fcResp.status}: ${JSON.stringify(fcData).slice(0, 300)}`);
            return { cards: [], totalHint: 0 };
          }
          const renderedHtml: string =
            (fcData.data && (fcData.data.html || fcData.data.rawHtml)) ||
            fcData.html || fcData.rawHtml || "";
          const renderedLinks: string[] =
            (fcData.data && fcData.data.links) || fcData.links || [];
          console.log(`[extract-product-list] Firecrawl returned htmlBytes=${renderedHtml.length} links=${renderedLinks.length}`);

          // Try to detect total product count from the page (e.g. "(808)")
          let totalHint = 0;
          const totalMatch = renderedHtml.match(/\((\d{2,})\)\s*<\/small>/i) ||
            renderedHtml.match(/(\d+)\s*(?:prodott[io]|result|artikl)/i);
          if (totalMatch) totalHint = parseInt(totalMatch[1], 10);

          let pageCards: Card[] = [];
          if (renderedHtml) {
            pageCards = extractCards(renderedHtml, new URL(pageUrl));
          }
          // Link-based fallback
          if (pageCards.length === 0 && renderedLinks.length > 0) {
            for (const href of renderedLinks) {
              if (!href || typeof href !== "string") continue;
              if (!/\/(p|product|prodotto|prodotti|products?)\//i.test(href) &&
                  !/\.html?$/i.test(href)) continue;
              if (/\/(category|categoria|search|cart|account|login)/i.test(href)) continue;
              let abs: string;
              try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
              const slug = (abs.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || "")
                .replace(/\.html?$/i, "").replace(/-/g, " ").trim();
              if (!slug || slug.length < 3) continue;
              pageCards.push({ name: slug, image: null, source_url: abs });
            }
          }
          return { cards: pageCards, totalHint };
        };

        try {
          // Scrape page 1
          const p1 = await scrapePage(normalized);
          let totalHint = p1.totalHint;
          for (const c of p1.cards) {
            if (!fcSeen.has(c.source_url)) { fcSeen.add(c.source_url); fcAllCards.push(c); }
          }
          console.log(`[extract-product-list] Firecrawl page 1: ${fcAllCards.length} cards (totalHint=${totalHint})`);

          // If we got cards and the site was blocked (fetchBlocked), try pagination
          if (fcAllCards.length > 0 && forceFallback && fcAllCards.length < max) {
            const perPage = fcAllCards.length || 24;
            const estimatedPages = totalHint ? Math.ceil(totalHint / perPage) : 10;
            const maxPages = Math.min(estimatedPages, 40); // cap at 40 pages
            // Scrape pages in batches of 3 to stay within timeout
            const BATCH = 3;
            for (let startPage = 2; startPage <= maxPages && fcAllCards.length < max; startPage += BATCH) {
              const batch: Promise<{ cards: Card[]; totalHint: number }>[] = [];
              for (let p = startPage; p < startPage + BATCH && p <= maxPages; p++) {
                const pageUrl = new URL(normalized);
                pageUrl.searchParams.set("p", String(p));
                batch.push(scrapePage(pageUrl.toString()));
              }
              const results = await Promise.all(batch);
              let anyNew = false;
              for (const r of results) {
                for (const c of r.cards) {
                  if (!fcSeen.has(c.source_url)) { fcSeen.add(c.source_url); fcAllCards.push(c); anyNew = true; }
                }
              }
              console.log(`[extract-product-list] Firecrawl pages ${startPage}-${startPage + BATCH - 1}: total ${fcAllCards.length}`);
              if (!anyNew) break; // no new products, stop
            }
          }

          if (fcAllCards.length > 0) {
            cards = fcAllCards;
            console.log(`[extract-product-list] Firecrawl total: ${cards.length} cards`);
          }
        } catch (fcErr) {
          console.log(`[extract-product-list] Firecrawl fetch failed: ${fcErr instanceof Error ? fcErr.message : fcErr}`);
        }
      }
    }

    // ===== Food-only filter for pharmacy sites =====
    // Some pharmacy sites (farmaciaeuropea.it, efarma.com, ...) mix food
    // products with drugs/supplements. When the source is a pharmacy, drop
    // anything whose name strongly indicates a drug, supplement, or cosmetic.
    const pharmacyHosts = /(farmaciaeuropea|farmacia|efarma|farmae|farmacosmo|topfarmacia|amicafarmacia|farmaciauno|farmaciaigea|benufarma|benu|drmax)/i;
    const isPharmacy = pharmacyHosts.test(baseUrl.host);
    if (isPharmacy) {
      const drugMarkers = /\b(integrator\w*|compress\w*|capsul\w*|bustin\w*|sciropp\w*|gocce|flacon\w*|fial\w*|sublingual\w*|orosolubil\w*|granular\w*|polvere?\s+oral\w+|spray|unguent\w*|pomat\w*|crema\b|gel\b|lozion\w*|deterg\w+|shampoo|balsamo|dentifric\w+|collutori\w*|sapon\w+|profum\w+|lacca|cosmetic\w*|farmac\w+|antibiotic\w+|analgesi\w+|antinfiamm\w+|antidolorif\w+|cerott\w+|garz\w+|siring\w+|termometr\w+|preservativ\w+|lubrificant\w+|repellent\w+|antizanzar\w+|abbronz\w+|doposole|pannolin\w+|assorbent\w+|salviett\w+|disinfettant\w+|antisettic\w+|cicatrizz\w+|colliri\w*|spazzolin\w+|nasal\w+|aerosol|inalator\w+|mascherin\w+)\b/i;
      const before = cards.length;
      cards = cards.filter((c) => !drugMarkers.test(c.name || ""));
      console.log(`[extract-product-list] food-only filter (pharmacy): ${before} -> ${cards.length}`);
    }

    const candidates = cards.slice(0, max);

    return new Response(
      JSON.stringify({
        candidates,
        total_links: candidates.length,
        total_available: prestashopTotal ?? (ajax?.allIds ? Array.from(new Set(ajax.allIds)).length : cards.length),
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

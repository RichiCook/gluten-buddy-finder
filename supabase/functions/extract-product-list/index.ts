import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    if (u.host !== baseUrl.host) return;
    if (
      /\/(cart|checkout|wishlist|account|login|register|content|orders|customer|search|brand|brands|categories?|tags?|manufacturer|cms)\b/i
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

    const resp = await fetch(normalized, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
      },
    });
    if (!resp.ok) throw new Error(`Fetch fallito: ${resp.status}`);
    const html = await resp.text();

    const setCookie = resp.headers.get("set-cookie") || "";
    const cookieHeader = setCookie
      .split(/,(?=[^;]+=[^;]+)/)
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const cards: Card[] = extractCards(html, baseUrl);
    const ajax = extractAjaxState(html);

    // PrestaShop detection: pages expose a `from-xhr=1` JSON endpoint that returns
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

    if (isPrestashop && cards.length > 0 && cards.length < max) {
      try {
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

          const ingestProducts = (products: any[]) => {
            for (const p of products || []) {
              const href = p?.url || p?.canonical_url || p?.link;
              const name = p?.name;
              const image = p?.cover?.large?.url || p?.cover?.medium_default?.url ||
                p?.cover?.bo_default?.url || p?.cover?.url || null;
              if (!href || !name) continue;
              if (cards.find((x) => x.source_url === href)) continue;
              try {
                const u = new URL(href, baseUrl);
                if (u.host !== baseUrl.host) continue;
              } catch { continue; }
              cards.push({ name: stripTags(String(name)), image, source_url: href });
            }
          };
          ingestProducts(j1?.products);

          for (let p = 2; p <= pagesCount && cards.length < max; p++) {
            const u = new URL(baseUrl.toString());
            u.searchParams.set("from-xhr", "1");
            u.searchParams.set("page", String(p));
            try {
              const rp = await fetch(u.toString(), {
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
              const before = cards.length;
              ingestProducts(jp?.products);
              console.log(`[extract-product-list] PrestaShop XHR page ${p}: +${cards.length - before} (total ${cards.length})`);
            } catch (err) {
              console.warn(`[extract-product-list] PrestaShop XHR page ${p} error:`, err);
            }
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
    } else {
      const paginationUrls = extractPaginationUrls(html, baseUrl);
      if (paginationUrls.length) {
        console.log(`[extract-product-list] following classic pagination: pages=${paginationUrls.length}`);
      }
      for (const pageUrl of paginationUrls) {
        if (cards.length >= max) break;
        try {
          const pageResp = await fetch(pageUrl, {
            headers: {
              "User-Agent": UA,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
              Cookie: cookieHeader,
            },
          });
          if (!pageResp.ok) continue;
          const pageHtml = await pageResp.text();
          const pageCards = extractCards(pageHtml, baseUrl);
          for (const c of pageCards) {
            if (!cards.find((x) => x.source_url === c.source_url)) {
              cards.push(c);
            }
          }
        } catch (error) {
          console.warn(`[extract-product-list] pagination fetch failed for ${pageUrl}:`, error);
        }
      }

      // Probe pagination pages until two consecutive pages add no new products.
      // Try both ?page=N (PrestaShop) and ?p=N (Magento) param styles.
      if (cards.length > 0 && cards.length < max) {
        for (const probeParam of ["page", "p"] as const) {
          if (cards.length >= max) break;
          // Skip if base URL already has this param set (avoids re-fetching same page)
          if (baseUrl.searchParams.has(probeParam)) continue;
          const probeUrls = buildProbePages(baseUrl, 50, probeParam);
          let consecutiveEmpty = 0;
          let firstAdded = false;
          console.log(`[extract-product-list] probing ?${probeParam}=N pages (start)`);
          for (const pageUrl of probeUrls) {
            if (cards.length >= max) break;
            if (consecutiveEmpty >= 2) break;
            try {
              const pageResp = await fetch(pageUrl, {
                headers: {
                  "User-Agent": UA,
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
                  Cookie: cookieHeader,
                },
              });
              if (!pageResp.ok) {
                consecutiveEmpty++;
                continue;
              }
              const pageHtml = await pageResp.text();
              const pageCards = extractCards(pageHtml, baseUrl);
              const before = cards.length;
              for (const c of pageCards) {
                if (!cards.find((x) => x.source_url === c.source_url)) {
                  cards.push(c);
                }
              }
              const added = cards.length - before;
              console.log(`[extract-product-list] probe ?${probeParam}=${pageUrl.match(/[?&](?:page|p)=(\d+)/)?.[1]}: cards+${added} (total ${cards.length})`);
              if (added === 0) consecutiveEmpty++;
              else { consecutiveEmpty = 0; firstAdded = true; }
            } catch (error) {
              console.warn(`[extract-product-list] probe failed for ${pageUrl}:`, error);
              consecutiveEmpty++;
            }
          }
          // If this param style worked (added new products), don't try the other one
          if (firstAdded) break;
        }
      }
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

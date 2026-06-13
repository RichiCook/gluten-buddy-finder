#!/usr/bin/env node
// import-products-from-excel.mjs
//
// Imports a catalog of products from an Excel (.xlsx, .xls, .csv) file
// into your NEW Supabase project's `products` table.
//
// The script is tolerant of column-name variations (Italian or English)
// so it works directly with whatever your Lovable exporter spits out.
//
// Usage:
//   1. Install xlsx parser ONCE (only needed first time):
//        npm install xlsx
//   2. Grab the NEW project service_role key:
//        https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/settings/api
//        → "Project API keys" → "service_role" (the secret one)
//   3. Run:
//        NEW_SERVICE_ROLE_KEY="eyJhbGc..." node import-products-from-excel.mjs <path-to-file>
//      Example:
//        NEW_SERVICE_ROLE_KEY="eyJ..." node import-products-from-excel.mjs ~/Downloads/glutenbb-export.xlsx
//
// Recognized columns (case-insensitive, Italian or English):
//   name | nome                       (required)
//   product_url | url | link          (required, used as dedupe key)
//   brand | marca | produttore
//   description | descrizione | desc
//   image_url | image | immagine | img
//   category | categoria
//   ingredient_tags | tags | ingredienti | ingredient_tags  (comma-separated list)
//
// Behavior:
//   - Rows missing `name` or `product_url` are skipped (logged)
//   - `category` is normalized to one of the allowed enum values; unknowns → 'altro'
//   - `ingredient_tags` is split on commas / semicolons / pipes into an array
//   - Products with a `product_url` already present in the NEW table are skipped (no duplicates)
//   - Inserts in batches of 500

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// --- Config -----------------------------------------------------------------
const NEW_URL = "https://yntqzzlbzzhrcrlkzisa.supabase.co";
const NEW_SERVICE_ROLE_KEY = process.env.NEW_SERVICE_ROLE_KEY;

const filePath = process.argv[2];

if (!NEW_SERVICE_ROLE_KEY) {
  console.error("\n❌  NEW_SERVICE_ROLE_KEY env var not set.\n");
  console.error(
    "    Get the secret key at:\n    https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/settings/api",
  );
  console.error("\n    Then run:");
  console.error(
    '    NEW_SERVICE_ROLE_KEY="eyJ..." node import-products-from-excel.mjs <file>\n',
  );
  process.exit(1);
}
if (!filePath) {
  console.error("\n❌  Usage: node import-products-from-excel.mjs <file.xlsx>\n");
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`\n❌  File not found: ${filePath}\n`);
  process.exit(1);
}

// --- Lazy-load xlsx so the script gives a friendly error if not installed ---
let XLSX;
try {
  XLSX = (await import("xlsx")).default || (await import("xlsx"));
} catch (e) {
  console.error("\n❌  xlsx package not installed. Run:");
  console.error("    npm install xlsx\n");
  process.exit(1);
}

const supabase = createClient(NEW_URL, NEW_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- Helpers ----------------------------------------------------------------
const VALID_CATEGORIES = new Set([
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
]);

const FIELD_ALIASES = {
  name: ["name", "nome", "prodotto", "product"],
  product_url: [
    "product_url",
    "url prodotto",
    "url_prodotto",
    "url",
    "link",
    "page_url",
    "pagina",
  ],
  brand: ["brand", "marca", "produttore", "azienda"],
  description: ["description", "descrizione", "desc"],
  image_url: [
    "image_url",
    "url immagine",
    "url_immagine",
    "image",
    "img",
    "immagine",
    "foto",
  ],
  category: ["category", "categoria", "cat"],
  ingredient_tags: [
    "ingredient_tags",
    "tag ingredienti",
    "tag_ingredienti",
    "tags",
    "ingredienti",
    "ingredient_tag",
    "ingredients",
    "keywords",
  ],
};

function buildKeyMap(headerRow) {
  const lowerToOriginal = {};
  for (const h of headerRow) {
    if (typeof h === "string") lowerToOriginal[h.toLowerCase().trim()] = h;
  }
  const map = {};
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (lowerToOriginal[alias]) {
        map[canonical] = lowerToOriginal[alias];
        break;
      }
    }
  }
  return map;
}

function normalizeCategory(raw) {
  if (!raw) return "altro";
  const s = String(raw).toLowerCase().trim();
  if (VALID_CATEGORIES.has(s)) return s;
  // Common variants
  const variants = {
    pane: ["bread", "panificato"],
    biscotti: ["biscotti", "cookies", "frollini", "frollino"],
    pasta: ["pasta", "noodles", "spaghetti"],
    farina: ["flour", "farine"],
    dolci: ["dolci", "dessert", "sweet", "torte", "torta"],
    snack: ["snack", "snacks", "merendine"],
    cereali: ["cereal", "cereali"],
    pizza: ["pizza", "pizze"],
    bevande: ["bevande", "drinks", "drink", "beer", "birra"],
  };
  for (const [cat, vs] of Object.entries(variants)) {
    if (vs.some((v) => s.includes(v))) return cat;
  }
  return "altro";
}

function normalizeTags(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string") return [String(raw)];
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// --- Main -------------------------------------------------------------------
console.log(`\n=== Importing ${filePath} ===\n`);

const buf = readFileSync(resolve(filePath));
const wb = XLSX.read(buf, { type: "buffer" });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

if (rows.length === 0) {
  console.error("❌  Sheet is empty.");
  process.exit(1);
}

const keyMap = buildKeyMap(Object.keys(rows[0]));
console.log("Column mapping detected:");
for (const [canonical, original] of Object.entries(keyMap)) {
  console.log(`  ${canonical.padEnd(18)} ← "${original}"`);
}
console.log();

const required = ["name", "product_url"];
const missing = required.filter((k) => !keyMap[k]);
if (missing.length) {
  console.error(`❌  Required columns missing: ${missing.join(", ")}`);
  console.error(
    "    Recognized aliases: " +
      Object.entries(FIELD_ALIASES)
        .filter(([k]) => missing.includes(k))
        .map(([k, a]) => `${k} → [${a.join(", ")}]`)
        .join(" / "),
  );
  process.exit(1);
}

console.log(`Parsing ${rows.length} rows…`);
const cleaned = [];
let skipped = 0;
for (const row of rows) {
  const name = row[keyMap.name];
  const product_url = row[keyMap.product_url];
  if (!name || !product_url) {
    skipped++;
    continue;
  }
  cleaned.push({
    name: String(name).trim(),
    product_url: String(product_url).trim(),
    brand: keyMap.brand ? row[keyMap.brand] || null : null,
    description: keyMap.description ? row[keyMap.description] || null : null,
    image_url: keyMap.image_url ? row[keyMap.image_url] || null : null,
    category: normalizeCategory(keyMap.category && row[keyMap.category]),
    ingredient_tags: normalizeTags(keyMap.ingredient_tags && row[keyMap.ingredient_tags]),
    created_by: null,
  });
}
console.log(`  ${cleaned.length} valid, ${skipped} skipped (missing name or url)\n`);

if (cleaned.length === 0) {
  console.log("Nothing to import.");
  process.exit(0);
}

// Dedupe against what's already in the NEW DB
console.log("Checking existing products in NEW…");
const existingUrls = new Set();
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("products")
    .select("product_url")
    .range(from, from + 999);
  if (error) {
    console.error("❌  Failed to read NEW DB:", error.message);
    console.error(
      "    (Make sure NEW_SERVICE_ROLE_KEY is the service_role secret, not anon.)",
    );
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  for (const r of data) existingUrls.add(r.product_url);
  if (data.length < 1000) break;
  from += data.length;
}
const toInsert = cleaned.filter((r) => !existingUrls.has(r.product_url));
console.log(`  ${existingUrls.size} already in NEW, ${toInsert.length} new to insert\n`);

if (toInsert.length === 0) {
  console.log("✓ Already in sync. Nothing to do.");
  process.exit(0);
}

console.log("Sample of what will be inserted:");
for (const r of toInsert.slice(0, 3)) {
  console.log(
    `  ${(r.brand || "?").padEnd(18)} ${r.name.padEnd(35)} ${r.category.padEnd(8)} tags=[${r.ingredient_tags.slice(0, 4).join(", ")}${r.ingredient_tags.length > 4 ? ", …" : ""}]`,
  );
}
console.log();

console.log(`Inserting ${toInsert.length} products in batches of 500…`);
let inserted = 0;
let failed = 0;
const failures = [];
for (const batch of chunk(toInsert, 500)) {
  const { error } = await supabase.from("products").insert(batch);
  if (error) {
    failed += batch.length;
    failures.push({ atIndex: inserted, message: error.message });
    process.stdout.write(`\n  ⚠️  Batch at ${inserted} failed: ${error.message}\n`);
  } else {
    inserted += batch.length;
  }
  process.stdout.write(`  ${inserted}/${toInsert.length}\r`);
}
console.log();

console.log(`\n✅  Done. Inserted ${inserted}, failed ${failed}.`);
if (failures.length) {
  console.log("Failures:");
  for (const f of failures.slice(0, 5))
    console.log(`  at row ${f.atIndex}: ${f.message}`);
  if (failures.length > 5) console.log(`  …and ${failures.length - 5} more.`);
}
console.log(
  `\nVerify: https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/editor`,
);

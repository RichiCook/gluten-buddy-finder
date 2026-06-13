#!/usr/bin/env node
// migrate-products-data.mjs
//
// One-shot copy of the `products` table from the OLD Lovable Cloud
// Supabase into your NEW dedicated Supabase project.
//
// Reads from OLD using the public anon key (allowed because the OLD
// products table has an RLS policy: FOR SELECT USING (true) — anyone
// can read products).
//
// Writes into NEW using the service_role key (bypasses RLS so admins
// can be inserted by the script).
//
// Usage:
//   1. Grab your NEW service_role key:
//      https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/settings/api
//      → "Project API keys" → "service_role" (the "secret" one, NOT anon)
//   2. Run:
//      NEW_SERVICE_ROLE_KEY="eyJhbGc..." node migrate-products-data.mjs
//
// The script:
//   - Lists how many products are in OLD
//   - Confirms with you before writing
//   - Copies in batches of 200 with progress output
//   - Skips products that already exist in NEW (matched by product_url)

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "readline";

// --- Config (hard-coded, since this is a one-time script) -----------------
const OLD_URL =
  "https://nvfulebzhtopywcjqbwr.supabase.co";
const OLD_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im52ZnVsZWJ6aHRvcHl3Y2pxYndyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTI2OTMsImV4cCI6MjA5Mjc4ODY5M30.eTB2bf0tDS9UMGhJKoyKJk1zbYVKdR47a8Vj3FzgdNs";
const NEW_URL =
  "https://yntqzzlbzzhrcrlkzisa.supabase.co";
const NEW_SERVICE_ROLE_KEY = process.env.NEW_SERVICE_ROLE_KEY;

if (!NEW_SERVICE_ROLE_KEY) {
  console.error("\n❌  NEW_SERVICE_ROLE_KEY env var not set.\n");
  console.error("Get the key here:");
  console.error(
    "   https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/settings/api",
  );
  console.error("   → look under \"Project API keys\" → \"service_role\"\n");
  console.error("Then run:");
  console.error("   NEW_SERVICE_ROLE_KEY=\"eyJhbGc...\" node migrate-products-data.mjs\n");
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_ANON_KEY);
const newClient = createClient(NEW_URL, NEW_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH = 200;

// --- Helpers ---------------------------------------------------------------
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// --- Main ------------------------------------------------------------------
console.log("\n=== Gluten Baby product catalog migration ===\n");

console.log("Reading old products catalog…");
const allOld = [];
let from = 0;
while (true) {
  const { data, error } = await oldClient
    .from("products")
    .select("*")
    .range(from, from + 999)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("❌  Old DB read failed:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  allOld.push(...data);
  from += data.length;
  if (data.length < 1000) break;
}
console.log(`  → ${allOld.length} products found in OLD`);

if (allOld.length === 0) {
  console.log("\nNothing to copy. The old project is also empty?");
  process.exit(0);
}

// Check what's already in NEW (so we don't duplicate)
const { data: existing, error: exErr } = await newClient
  .from("products")
  .select("product_url");
if (exErr) {
  console.error("❌  New DB read failed:", exErr.message);
  console.error(
    "    (Make sure NEW_SERVICE_ROLE_KEY is the service_role secret, not the anon key.)",
  );
  process.exit(1);
}
const existingUrls = new Set((existing || []).map((p) => p.product_url));
console.log(`  → ${existingUrls.size} products already in NEW`);

const toInsert = allOld.filter((p) => !existingUrls.has(p.product_url));
console.log(`  → ${toInsert.length} new products to copy\n`);

if (toInsert.length === 0) {
  console.log("✓ NEW is already in sync. Nothing to do.");
  process.exit(0);
}

const sample = toInsert[0];
console.log("Sample product to copy:");
console.log(
  `  ${sample.brand ?? "?"} - ${sample.name} (${sample.category})`,
);
console.log(`  URL: ${sample.product_url}\n`);

const answer = await ask(
  `Copy ${toInsert.length} products into the NEW Supabase project? [y/N]: `,
);
if (answer.toLowerCase() !== "y") {
  console.log("Cancelled.");
  process.exit(0);
}

console.log("\nCopying…");
let inserted = 0;
let failed = 0;
for (const batch of chunk(toInsert, BATCH)) {
  // Strip created_by — the old admin user doesn't exist in the new project,
  // and the column is nullable. Leaving it would foreign-key fail.
  const cleaned = batch.map(({ created_by, ...rest }) => ({
    ...rest,
    created_by: null,
  }));
  const { error } = await newClient
    .from("products")
    .insert(cleaned);
  if (error) {
    console.error(
      `  ⚠️  Batch starting at ${inserted} failed:`,
      error.message,
    );
    failed += batch.length;
  } else {
    inserted += batch.length;
    process.stdout.write(`  ${inserted}/${toInsert.length}\r`);
  }
}
console.log();

console.log(`\n✅  Done. Inserted ${inserted}, failed ${failed}.`);
console.log(
  `\nVerify in the dashboard: https://supabase.com/dashboard/project/yntqzzlbzzhrcrlkzisa/editor`,
);

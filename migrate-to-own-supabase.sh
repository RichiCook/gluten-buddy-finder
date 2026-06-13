#!/usr/bin/env bash
# migrate-to-own-supabase.sh
#
# Wires the Gluten Baby codebase to YOUR dedicated Supabase project
# (yntqzzlbzzhrcrlkzisa) instead of the Lovable-managed one.
#
# What this does:
#   1. Logs into Supabase CLI (interactive, one-time)
#   2. Links this repo to your project
#   3. Pushes all 9 SQL migrations to create the schema
#   4. Deploys all 4 edge functions
#   5. Sets the GEMINI_API_KEY secret (you'll paste it when prompted)
#   6. Rebuilds the web bundle + syncs to iOS
#
# Prerequisites on your Mac:
#   - Supabase CLI installed:  brew install supabase/tap/supabase
#   - A Gemini API key from: https://aistudio.google.com/apikey
#
# Usage:
#   chmod +x migrate-to-own-supabase.sh
#   ./migrate-to-own-supabase.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PROJECT_REF="yntqzzlbzzhrcrlkzisa"

echo "==> Working in: $PROJECT_DIR"
echo "==> Target Supabase project: $PROJECT_REF"
echo

# --- Pre-flight ---------------------------------------------------------------
if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: Supabase CLI not installed." >&2
  echo "Install with:  brew install supabase/tap/supabase" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: node + npm required." >&2
  exit 1
fi

# --- 1. Log in to Supabase CLI ------------------------------------------------
echo "==> Checking Supabase login status"
if ! supabase projects list >/dev/null 2>&1; then
  echo "    Not logged in. Opening browser for login…"
  supabase login
else
  echo "    Already logged in ✓"
fi

# --- 2. Link this repo to the new project -------------------------------------
echo
echo "==> Linking repo to project $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

# --- 3. Push the 9 SQL migrations ---------------------------------------------
echo
echo "==> Pushing database migrations"
echo "    (If this fails because the new project already has tables,"
echo "     reset it with: supabase db reset --linked   and re-run.)"
supabase db push

# --- 4. Deploy edge functions -------------------------------------------------
echo
echo "==> Deploying edge functions"
for fn in recognize-image match-products extract-product-list extract-product-url; do
  echo "    → $fn"
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

# --- 5. Set Gemini API key as a secret ----------------------------------------
echo
echo "==> Setting GEMINI_API_KEY secret"
echo "    Get your key at: https://aistudio.google.com/apikey"
echo "    Paste it below (input is hidden), or press Enter to skip."
read -rsp "GEMINI_API_KEY: " GEMINI_API_KEY
echo
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  supabase secrets set "GEMINI_API_KEY=$GEMINI_API_KEY" --project-ref "$PROJECT_REF"
  echo "    Secret set ✓"
else
  echo "    Skipped. You can set it later with:"
  echo "    supabase secrets set GEMINI_API_KEY=… --project-ref $PROJECT_REF"
fi

# Optional: also set FIRECRAWL_API_KEY if you want the extract-product-list
# function's web-scraping fallback to work. Skip if you don't use Firecrawl.
echo
read -rp "Set FIRECRAWL_API_KEY too? [y/N]: " WANT_FIRECRAWL
if [[ "${WANT_FIRECRAWL:-N}" =~ ^[Yy]$ ]]; then
  read -rsp "FIRECRAWL_API_KEY: " FIRECRAWL_API_KEY
  echo
  if [[ -n "${FIRECRAWL_API_KEY:-}" ]]; then
    supabase secrets set "FIRECRAWL_API_KEY=$FIRECRAWL_API_KEY" --project-ref "$PROJECT_REF"
  fi
fi

# --- 6. Rebuild the web bundle and sync to iOS --------------------------------
echo
echo "==> npm install (in case deps changed)"
npm install --no-audit --no-fund

echo
echo "==> npm run build (compiles with new .env values baked in)"
npm run build

echo
echo "==> npx cap sync ios (copies new bundle into Xcode project)"
npx cap sync ios

# --- Done ---------------------------------------------------------------------
cat <<EOF

✅  Migration complete.

Next steps in Xcode:
  1. Open the project        → Xcode menu: File → Open → ios/App/App.xcworkspace
                              (or run: npx cap open ios)
  2. Bump Build number       → TARGETS → App → General → Build (e.g. 1 → 2)
  3. Product → Archive       → upload to App Store Connect
  4. App Store Connect       → Distribution → Build → swap to the new build

Quick sanity check before re-releasing:
  - Open the simulator (▶) and take a test photo. If recognize-image works,
    your new Supabase + direct Gemini wiring is good.
  - If you see "GEMINI_API_KEY non configurata", re-run step 5 (secrets set).
  - Watch logs:  supabase functions logs recognize-image --project-ref $PROJECT_REF

Direct dashboard links:
  Project home    : https://supabase.com/dashboard/project/$PROJECT_REF
  Edge functions  : https://supabase.com/dashboard/project/$PROJECT_REF/functions
  Database tables : https://supabase.com/dashboard/project/$PROJECT_REF/editor
  Auth users      : https://supabase.com/dashboard/project/$PROJECT_REF/auth/users
EOF

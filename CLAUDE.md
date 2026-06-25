# Gluten Baby — iOS app

Vite + React + TypeScript + Tailwind, wrapped in Capacitor for iOS.
Developed solo by Riccardo Cook. Camilla Andreolli is admin. Sette pending admin.

## Where things live
- GitHub: https://github.com/RichiCook/gluten-buddy-finder (main branch)
- Web preview (always-latest): https://glutenbb-web.vercel.app
- iOS app: TestFlight (Build 5 currently live on the pre-redesign codebase)
- Supabase backend: project `yntqzzlbzzhrcrlkzisa` ("GlutenBaby's Org")
- Admin dashboard (sister repo): `../mission-control` → missioncontrol.glutenbaby.com

## Stack
- React + Vite + TypeScript + Tailwind + shadcn/ui
- React Router, TanStack Query, sonner toasts
- Supabase JS client (`src/integrations/supabase/client.ts`)
- Capacitor 8 wraps `dist/` into a native iOS shell

## Key files
- `src/App.tsx` — routes + AuthGateProvider
- `src/pages/Scan.tsx` — home (route `/`). Apple-style hero + dark pill camera CTA + recent-scans rail.
- `src/pages/Confirm.tsx` — after a scan. Has clearable dish name input, ingredient pills (X to remove), inline product preview carousel.
- `src/pages/Results.tsx` — alternatives grid after Conferma.
- `src/pages/Sfoglia.tsx` — catalog browser. Search, smart category filter (matches enum + name patterns), paginated grid.
- `src/pages/Favorites.tsx`, `Account.tsx`, `Auth.tsx`, `Admin.tsx`
- `src/components/AppLayout.tsx` — sticky header w/ optional `topbar` slot, bottom nav, cream wheat bg.
- `src/components/BottomNav.tsx` — 4 tabs: Home / Sfoglia / Salvati / Account (+ Admin).
- `src/components/AuthDialog.tsx` — modal sign-up + sign-in.
- `src/hooks/useAuthGate.tsx` — `useAuthGate().requestAuth(action, reason)` opens the modal when guest, runs the action after success.
- `supabase/functions/recognize-image/index.ts` — Gemini call (direct via OpenAI-compat endpoint). Uses `GEMINI_API_KEY` Supabase secret.
- `supabase/functions/match-products/index.ts` — finds catalog matches for an ingredient list.
- `supabase/migrations/` — full schema. Most recent are health/rules/categories helpers.

## Schema (products table)
Columns: id, name, brand, description, image_url, product_url, category (`product_category` enum), ingredient_tags (text[]), created_by, created_at, updated_at.

`product_category` enum values:
`pasta, biscotti, pane, farina, dolci, snack, cereali, pizza, bevande, altro` plus anything admin added via Mission Control / Categories.

14,358 products imported from old Lovable Cloud catalog on 13 Jun 2026.

## Common workflow

### Web-only design tweak (most common)
1. Edit a file under `src/`.
2. Deploy:
   ```
   git add -A && git commit -m "..." && git push
   vercel deploy --prod
   ```
3. Open https://glutenbb-web.vercel.app to verify.
**User has opted out of GitHub auto-deploy on Vercel — always remind them to run the deploy command after editing.**

### Backend / AI prompt tweak
1. Edit `supabase/functions/recognize-image/index.ts`.
2. Deploy:
   ```
   npx supabase functions deploy recognize-image --project-ref yntqzzlbzzhrcrlkzisa
   ```
3. Live for users in ~10 sec. No App Store cycle.

### iOS release
1. After verifying changes on web preview:
   ```
   npm run build && npx cap sync ios && npx cap open ios
   ```
2. Xcode → bump Build #, Product → Archive, Distribute → Upload.
3. App Store Connect → swap to new build → resubmit if a public release.

## Conventions
- Italian copy throughout the UI.
- Tailwind colors driven by `src/index.css` HSL variables. Editing `--primary` etc. re-themes the whole app.
- Bottom nav uses `lucide-react` icons.
- Toasts via `toast()` from sonner.
- Server logic only inside Supabase Edge Functions, never on the client.

## Gotchas
- `.env` is committed (contains `VITE_SUPABASE_*` — anon keys are public by design). Service role key is NOT in this repo — it lives only in Supabase Dashboard + Mission Control's Vercel env vars.
- Capacitor `contentInset` is NOT set — we use CSS `env(safe-area-inset-*)` in `src/index.css` for status-bar handling.
- iOS Sfoglia category pills are hardcoded — adding a new enum value via Mission Control won't surface as a filter pill in the iOS app until a redeploy of the React source with the new pill added.

## Recent migrations applied to the live Supabase
- `20260614180721_product_health_helpers.sql`
- `20260616094321_category_rule_helpers.sql`
- `20260616140045_category_rule_exclusions.sql`
- `20260617124552_categories_management.sql`
- Plus a one-line: `ALTER TYPE public.product_category ADD VALUE IF NOT EXISTS 'bevande';`

## Don't do
- Don't reintroduce Lovable Cloud dependencies (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`, `server.url` in capacitor.config). User migrated AWAY from these and wants them gone.
- Don't set up GitHub → Vercel auto-deploy. User explicitly opted out — they prefer manual deploys.
- Don't store secrets in the repo. Only public `VITE_*` keys belong in `.env`.

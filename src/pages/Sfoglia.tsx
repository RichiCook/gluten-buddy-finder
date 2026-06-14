import { useEffect, useMemo, useState } from "react";
import { Search, Star, ShoppingCart, ImageOff, Loader2, X } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAuthGate } from "@/hooks/useAuthGate";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_url: string;
  category: string;
}

const CATEGORIES: { id: string; label: string; emoji: string }[] = [
  { id: "all", label: "Tutti", emoji: "✨" },
  { id: "pasta", label: "Pasta", emoji: "🍝" },
  { id: "pane", label: "Pane", emoji: "🍞" },
  { id: "biscotti", label: "Biscotti", emoji: "🍪" },
  { id: "pizza", label: "Pizza", emoji: "🍕" },
  { id: "bevande", label: "Bevande", emoji: "🥤" },
  { id: "dolci", label: "Dolci", emoji: "🍰" },
  { id: "snack", label: "Snack", emoji: "🥨" },
  { id: "cereali", label: "Cereali", emoji: "🌾" },
  { id: "farina", label: "Farina", emoji: "🥐" },
  { id: "altro", label: "Altro", emoji: "⭐" },
];

const PAGE_SIZE = 30;

export default function Sfoglia() {
  const { user } = useAuth();
  const { requestAuth } = useAuthGate();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Debounce search input so we don't query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when category changes
  useEffect(() => {
    setPage(0);
  }, [category]);

  // Load products (first page on category/search change, or paginated on page change)
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (page === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      let query = supabase
        .from("products")
        .select("id, name, brand, image_url, product_url, category")
        .order("name", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (category !== "all") {
        query = query.eq("category", category as any);
      }
      if (debouncedSearch) {
        const term = `%${debouncedSearch}%`;
        query = query.or(`name.ilike.${term},brand.ilike.${term}`);
      }

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const items = (data ?? []) as Product[];
      setProducts((prev) => (page === 0 ? items : [...prev, ...items]));
      setHasMore(items.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, category, page]);

  // Load current favorites for star-fill state
  useEffect(() => {
    if (!user) {
      setFavIds(new Set());
      return;
    }
    void supabase
      .from("favorites")
      .select("product_id")
      .then(({ data }) => {
        if (data) setFavIds(new Set(data.map((f) => f.product_id)));
      });
  }, [user]);

  async function toggleFav(p: Product) {
    if (!user) return;
    if (favIds.has(p.id)) {
      await supabase
        .from("favorites")
        .delete()
        .eq("product_id", p.id)
        .eq("user_id", user.id);
      const next = new Set(favIds);
      next.delete(p.id);
      setFavIds(next);
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ product_id: p.id, user_id: user.id });
      if (error) {
        toast.error(error.message);
        return;
      }
      setFavIds(new Set(favIds).add(p.id));
      toast.success("Salvato nei preferiti");
    }
  }

  function requestToggleFav(p: Product) {
    requestAuth(
      () => void toggleFav(p),
      `Crea un account per salvare "${p.name}" nei tuoi preferiti.`,
    );
  }

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Hero */}
        <div className="pt-2">
          <h1 className="text-3xl font-medium leading-tight tracking-tight text-foreground">
            Sfoglia
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Esplora il catalogo gluten-free
          </p>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca prodotti o marche…"
            className="w-full rounded-full border border-border bg-card/80 py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground outline-none backdrop-blur-sm focus:border-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:bg-secondary"
              aria-label="Cancella ricerca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Category pills — horizontal scroll */}
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-2">
            {CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition active:scale-95",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card/60 text-foreground",
                  )}
                >
                  <span aria-hidden="true">{c.emoji}</span>
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Result count / status */}
        {!loading && (
          <p className="text-xs text-muted-foreground">
            {products.length === 0
              ? "Nessun prodotto trovato"
              : `${products.length}${hasMore ? "+" : ""} prodotti`}
          </p>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* Empty state */}
        {!loading && products.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Nessun prodotto trovato
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Prova a cambiare categoria o ricerca
            </p>
          </div>
        )}

        {/* Product grid */}
        {!loading && products.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => {
              const isFav = favIds.has(p.id);
              return (
                <div
                  key={p.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="relative aspect-square bg-secondary">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-muted-foreground">
                        <ImageOff className="h-8 w-8" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => requestToggleFav(p)}
                      className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/85 backdrop-blur-sm"
                      aria-label={isFav ? "Rimuovi dai preferiti" : "Salva"}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          isFav
                            ? "fill-accent text-accent"
                            : "text-foreground",
                        )}
                      />
                    </button>
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-xs font-medium leading-tight text-foreground">
                      {p.name}
                    </p>
                    {p.brand && (
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {p.brand}
                      </p>
                    )}
                    <a
                      href={p.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground"
                    >
                      <ShoppingCart className="h-3 w-3" />
                      Acquista
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load more */}
        {!loading && products.length > 0 && hasMore && (
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loadingMore}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card/60 py-3 text-sm font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Caricamento…
              </>
            ) : (
              <>Carica altri prodotti</>
            )}
          </button>
        )}
      </div>
    </AppLayout>
  );
}

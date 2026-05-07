import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShoppingCart, Star, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

interface Product {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_url: string;
  category: string;
  description: string | null;
}

export default function Results() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [matches, setMatches] = useState<{ ingredient: any; products: Product[] }[]>([]);
  const [dishName, setDishName] = useState("");
  const [loading, setLoading] = useState(true);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const raw = sessionStorage.getItem("gb_confirmed");
    if (!raw) {
      navigate("/");
      return;
    }
    const { ingredients, dishName } = JSON.parse(raw);
    setDishName(dishName);
    runMatch(ingredients);
    if (user) loadFavs();
  }, [user, navigate]);

  async function runMatch(ingredients: any[]) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("match-products", {
        body: { ingredients },
      });
      if (error) throw error;
      setMatches(data?.matches || []);
    } catch (e: any) {
      toast.error(e?.message || "Errore nella ricerca");
    } finally {
      setLoading(false);
    }
  }

  async function loadFavs() {
    const { data } = await supabase.from("favorites").select("product_id");
    setFavIds(new Set((data || []).map((f) => f.product_id)));
  }

  async function toggleFav(p: Product) {
    if (!user) {
      toast.info("Accedi per salvare i preferiti");
      navigate("/auth?redirect=/results");
      return;
    }
    if (favIds.has(p.id)) {
      await supabase.from("favorites").delete().eq("product_id", p.id).eq("user_id", user.id);
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

  return (
    <AppLayout title="Risultati">
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Alternative senza glutine per
          </p>
          <h1 className="text-xl font-bold">{dishName}</h1>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {!loading && matches.length === 0 && (
          <p className="text-center text-muted-foreground">Nessun risultato.</p>
        )}

        {matches.map((m, i) => (
          <section key={i}>
            <h2 className="mb-3 text-base font-semibold">
              🌾 {m.ingredient.name}{" "}
              <Badge variant="secondary" className="ml-1 text-xs">
                {m.ingredient.category}
              </Badge>
            </h2>
            {m.products.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">
                Nessun prodotto senza glutine trovato per questa categoria. Chiedi
                all'admin di aggiungerne!
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {m.products.map((p) => (
                  <Card
                    key={p.id}
                    className="overflow-hidden shadow-soft transition-transform hover:scale-[1.02]"
                  >
                    <div className="relative aspect-square bg-muted">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <ImageOff className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <button
                        onClick={() => toggleFav(p)}
                        className="absolute right-2 top-2 rounded-full bg-card/95 p-2 shadow-soft"
                        aria-label="Salva preferito"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            favIds.has(p.id)
                              ? "fill-accent text-accent"
                              : "text-muted-foreground"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="space-y-2 p-3">
                      {p.brand && (
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.brand}
                        </p>
                      )}
                      <h3 className="line-clamp-2 text-sm font-semibold">
                        {p.name}
                      </h3>
                      <Button
                        size="sm"
                        className="w-full bg-gradient-primary"
                        asChild
                      >
                      <a
                          href={p.product_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => trackEvent("product_click", { name: p.name, brand: p.brand }, p.id)}
                        >
                          <ShoppingCart className="h-3 w-3" />
                          Acquista
                        </a>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </AppLayout>
  );
}

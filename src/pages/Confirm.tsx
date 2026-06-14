import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Plus,
  ArrowRight,
  RotateCcw,
  ShoppingCart,
  ImageOff,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const CATEGORIES = [
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
];

interface Ingredient {
  name: string;
  category: string;
  description?: string;
  search_keywords?: string[];
}

interface PreviewProduct {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_url: string;
  category: string;
}

export default function Confirm() {
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [dishName, setDishName] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("pasta");
  const [previewProducts, setPreviewProducts] = useState<PreviewProduct[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("gb_scan");
    if (!raw) {
      navigate("/");
      return;
    }
    const { image, result } = JSON.parse(raw);
    setImage(image);
    setDishName(result?.dish_name || "");
    setIngredients(result?.gluten_ingredients || []);
  }, [navigate]);

  // Stable signature so the preview only refetches when ingredients actually change
  const ingredientsKey = useMemo(
    () => ingredients.map((i) => `${i.name}|${i.category}`).join(","),
    [ingredients],
  );

  // Fetch a preview of matching alternatives whenever ingredients change.
  // Calls the same match-products edge function the Results page uses,
  // so what users see here matches what they'd see after Conferma.
  useEffect(() => {
    if (ingredients.length === 0) {
      setPreviewProducts([]);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void supabase.functions
      .invoke("match-products", {
        body: { dishName, ingredients },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.matches) {
          setPreviewProducts([]);
          setPreviewLoading(false);
          return;
        }
        // Flatten and dedupe across all ingredient matches; cap at 8 cards.
        const flat: PreviewProduct[] = [];
        const seen = new Set<string>();
        for (const m of data.matches as { products?: PreviewProduct[] }[]) {
          for (const p of m.products ?? []) {
            if (!seen.has(p.id)) {
              seen.add(p.id);
              flat.push(p);
              if (flat.length >= 8) break;
            }
          }
          if (flat.length >= 8) break;
        }
        setPreviewProducts(flat);
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredientsKey]);

  function removeIngredient(i: number) {
    setIngredients((arr) => arr.filter((_, idx) => idx !== i));
  }

  function addIngredient() {
    if (!newName.trim()) return;
    const n = newName.trim();
    setIngredients((arr) => [
      ...arr,
      { name: n, category: newCat, search_keywords: [n.toLowerCase()] },
    ]);
    setNewName("");
  }

  function confirm() {
    if (ingredients.length === 0) {
      toast.error("Aggiungi almeno un ingrediente da cercare");
      return;
    }
    sessionStorage.setItem(
      "gb_confirmed",
      JSON.stringify({ image, dishName, ingredients }),
    );
    navigate("/results");
  }

  return (
    <AppLayout title="Conferma">
      <div className="space-y-5">
        {image && (
          <Card className="overflow-hidden">
            <img src={image} alt="" className="max-h-56 w-full object-cover" />
          </Card>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Cosa abbiamo riconosciuto
          </label>
          <div className="relative">
            <Input
              value={dishName}
              onChange={(e) => setDishName(e.target.value)}
              placeholder="Non è ciò che cerchi? Scrivi qui"
              className="pr-10 text-base font-semibold"
            />
            {dishName && (
              <button
                type="button"
                onClick={() => setDishName("")}
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                aria-label="Cancella nome"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div>
          {ingredients.length > 0 && (
            <h3 className="mb-2 text-sm font-semibold">
              Ingredienti con glutine ({ingredients.length})
            </h3>
          )}
          {ingredients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 text-center space-y-1">
              <p className="text-sm font-semibold text-primary">
                ✅ Prodotto non contenente glutine
              </p>
              <p className="text-xs text-muted-foreground">
                Non sono stati rilevati ingredienti con glutine. Puoi comunque aggiungerne manualmente qui sotto.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ingredients.map((ing, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-foreground">{ing.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {ing.category}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => removeIngredient(i)}
                    className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                    aria-label={`Rimuovi ${ing.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {(previewLoading || previewProducts.length > 0) &&
          ingredients.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Anteprima alternative
              </h3>
              <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex gap-2">
                  {previewLoading
                    ? [0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-28 flex-shrink-0 animate-pulse"
                        >
                          <div className="aspect-square rounded-xl bg-secondary" />
                          <div className="mt-2 h-3 w-2/3 rounded bg-secondary" />
                          <div className="mt-1 h-3 w-1/2 rounded bg-secondary" />
                        </div>
                      ))
                    : previewProducts.map((p) => (
                        <a
                          key={p.id}
                          href={p.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-28 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
                        >
                          <div className="aspect-square bg-secondary">
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.name}
                                loading="lazy"
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-muted-foreground">
                                <ImageOff className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="p-2">
                            {p.brand && (
                              <p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                                {p.brand}
                              </p>
                            )}
                            <p className="line-clamp-2 text-[10px] font-medium leading-tight text-foreground">
                              {p.name}
                            </p>
                            <div className="mt-1.5 flex items-center justify-center gap-1 rounded-full bg-primary py-1 text-[9px] font-medium text-primary-foreground">
                              <ShoppingCart className="h-2.5 w-2.5" />
                              Acquista
                            </div>
                          </div>
                        </a>
                      ))}
                </div>
              </div>
            </div>
          )}

        <Card className="space-y-2 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Aggiungi un ingrediente
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="es. spaghetti"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select value={newCat} onValueChange={setNewCat}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" onClick={addIngredient}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => navigate("/")}
          >
            <RotateCcw className="h-4 w-4" />
            Rifai
          </Button>
          <Button
            className="flex-1 bg-gradient-primary shadow-glow"
            onClick={confirm}
          >
            Conferma
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}

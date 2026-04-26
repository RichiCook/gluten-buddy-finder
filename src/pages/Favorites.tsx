import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Trash2, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export default function Favorites() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [favs, setFavs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth?redirect=/favorites");
      return;
    }
    load();
  }, [user, authLoading, navigate]);

  async function load() {
    const { data } = await supabase
      .from("favorites")
      .select("id, product:products(*)")
      .order("created_at", { ascending: false });
    setFavs(data || []);
    setLoading(false);
  }

  async function remove(id: string) {
    await supabase.from("favorites").delete().eq("id", id);
    setFavs((arr) => arr.filter((f) => f.id !== id));
  }

  return (
    <AppLayout title="Preferiti">
      {loading ? (
        <p className="text-center text-muted-foreground">Caricamento…</p>
      ) : favs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Non hai ancora salvato nessun prodotto. ⭐
        </p>
      ) : (
        <div className="space-y-3">
          {favs.map((f) => (
            <Card key={f.id} className="flex gap-3 overflow-hidden p-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
                {f.product?.image_url ? (
                  <img
                    src={f.product.image_url}
                    alt={f.product.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageOff className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-1">
                {f.product?.brand && (
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {f.product.brand}
                  </p>
                )}
                <h3 className="text-sm font-semibold">{f.product?.name}</h3>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="bg-gradient-primary" asChild>
                    <a href={f.product?.product_url} target="_blank" rel="noreferrer">
                      <ShoppingCart className="h-3 w-3" />
                      Acquista
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(f.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

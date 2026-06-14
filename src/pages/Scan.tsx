import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Camera,
  ImagePlus,
  Search,
  Loader2,
  AlertTriangle,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

type RecentScan = {
  id: string;
  ai_dish_name: string | null;
  ai_kind: string | null;
  ai_ingredients: any;
  created_at: string;
};

export default function Scan() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  const firstName = useMemo(() => {
    const meta = user?.user_metadata?.display_name as string | undefined;
    if (meta) {
      const first = meta.trim().split(/\s+/)[0];
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
    if (user?.email) {
      const local = user.email.split("@")[0];
      const first = local.split(/[\s.\-_]/)[0];
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
    return "";
  }, [user]);

  const initials = useMemo(() => {
    if (!firstName) return "GB";
    return firstName.slice(0, 2).toUpperCase();
  }, [firstName]);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("scans")
      .select("id, ai_dish_name, ai_kind, ai_ingredients, created_at")
      .order("created_at", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (data) setRecentScans(data as RecentScan[]);
      });
  }, [user]);

  async function handleFile(file: File) {
    if (!file) return;
    setLoading(true);
    try {
      // Comprimi e ridimensiona la foto: evita superare la quota di sessionStorage
      // e riduce i tempi di upload all'AI.
      const dataUrl = await fileToCompressedDataUrl(file, 1280, 0.82);

      const { data, error } = await supabase.functions.invoke("recognize-image", {
        body: { imageDataUrl: dataUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Salva in sessionStorage; se ancora troppo grande, fai fallback senza immagine
      try {
        sessionStorage.setItem(
          "gb_scan",
          JSON.stringify({ image: dataUrl, result: data }),
        );
      } catch {
        sessionStorage.setItem(
          "gb_scan",
          JSON.stringify({ image: null, result: data }),
        );
      }
      trackEvent("scan", { dish: data?.dish_name || "" });
      navigate("/confirm");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Errore durante il riconoscimento");
    } finally {
      setLoading(false);
    }
  }

  const topbar = (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        {firstName ? (
          <>
            Ciao,{" "}
            <span className="font-medium text-foreground">{firstName}</span>
          </>
        ) : (
          <Link to="/auth" className="font-medium text-primary">
            Accedi
          </Link>
        )}
      </div>
      {user ? (
        <Link
          to="/account"
          className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initials}
        </Link>
      ) : (
        <span className="text-xs font-medium tracking-tight text-primary">
          Gluten Baby
        </span>
      )}
    </div>
  );

  return (
    <AppLayout topbar={topbar}>
      <div className="space-y-7">
        {/* Hero */}
        <div className="pt-2">
          <h1 className="text-3xl font-medium leading-tight tracking-tight text-foreground">
            Cosa scansioni
            <br />
            oggi?
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Punta fotocamera su piatto o prodotto per trovare alternative senza
            glutine
          </p>
        </div>

        {/* Primary pill CTA — Apple-style dark pill */}
        <button
          type="button"
          onClick={() => cameraInput.current?.click()}
          disabled={loading}
          className={cn(
            "flex w-full items-center gap-3 rounded-full px-5 py-4 text-background transition active:scale-[0.98] disabled:opacity-70",
            "bg-foreground",
          )}
        >
          <div className="grid h-9 w-9 place-items-center rounded-full bg-background/15">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
          </div>
          <span className="flex-1 text-left text-base font-medium tracking-tight">
            {loading ? "Sto analizzando…" : "Apri fotocamera"}
          </span>
          <ArrowUpRight className="h-5 w-5 opacity-60" />
        </button>

        {/* Secondary chip row */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card/60 px-3 py-3 text-sm font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" />
            Galleria
          </button>
          <Link
            to="/sfoglia"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border bg-card/60 px-3 py-3 text-sm font-medium text-foreground transition active:scale-[0.98]"
          >
            <Search className="h-4 w-4" />
            Cerca
          </Link>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        {/* Recenti rail (only if signed in and has at least one scan) */}
        {user && recentScans.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-base font-medium tracking-tight text-foreground">
                Recenti
              </h2>
              <Link to="/favorites" className="text-xs text-primary">
                Vedi tutti
              </Link>
            </div>
            <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex gap-2.5">
                {recentScans.map((s) => {
                  const ings = Array.isArray(s.ai_ingredients)
                    ? s.ai_ingredients
                    : [];
                  const hasGluten = ings.length > 0;
                  return (
                    <div
                      key={s.id}
                      className="w-24 flex-shrink-0 rounded-2xl bg-card p-2 shadow-sm"
                    >
                      <div className="grid h-16 w-full place-items-center rounded-xl bg-secondary text-primary">
                        <Camera className="h-6 w-6" />
                      </div>
                      <div className="mt-2 line-clamp-1 text-xs font-medium leading-tight text-foreground">
                        {s.ai_dish_name || "Senza titolo"}
                      </div>
                      <div
                        className={cn(
                          "mt-1 flex items-center gap-0.5 text-[10px] font-medium",
                          hasGluten ? "text-destructive" : "text-emerald-700",
                        )}
                      >
                        {hasGluten ? (
                          <>
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Glutine
                          </>
                        ) : (
                          <>
                            <Check className="h-2.5 w-2.5" />
                            Sicuro
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Sign-in prompt for anonymous */}
        {!user && (
          <div className="rounded-2xl border border-border bg-card/60 p-5 text-center">
            <p className="mb-3 text-sm text-muted-foreground">
              Accedi per salvare le tue scansioni e i prodotti preferiti
            </p>
            <Link
              to="/auth"
              className="inline-block rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
            >
              Accedi
            </Link>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Ridimensiona la foto al lato massimo indicato e la converte in JPEG compresso.
async function fileToCompressedDataUrl(
  file: File,
  maxSize = 1280,
  quality = 0.82,
): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  try {
    const img = await loadImage(dataUrl);
    const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

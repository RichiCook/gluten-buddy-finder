import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ImagePlus, Loader2, Sparkles } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

export default function Scan() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!file) return;
    setLoading(true);
    try {
      // Comprimi e ridimensiona la foto: evita superare la quota di sessionStorage
      // e riduce i tempi di upload all'AI.
      const dataUrl = await fileToCompressedDataUrl(file, 1280, 0.82);
      setPreview(dataUrl);

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

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">
            Trova prodotti senza glutine
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Scatta una foto a un prodotto o a un piatto: troviamo per te le
            alternative gluten-free.
          </p>
        </div>

        <Card className="overflow-hidden border-2 border-dashed border-primary/30 bg-card p-6 shadow-soft">
          {preview ? (
            <img
              src={preview}
              alt="anteprima"
              className="mx-auto max-h-64 rounded-lg object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="mb-4 rounded-full bg-gradient-primary p-5 shadow-glow">
                <Sparkles className="h-8 w-8 text-primary-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Pronto a scansionare il tuo prossimo pasto?
              </p>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3">
          <Button
            size="lg"
            className="h-14 text-base bg-gradient-primary shadow-glow"
            disabled={loading}
            onClick={() => cameraInput.current?.click()}
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Camera className="h-5 w-5" />
                Scatta una foto
              </>
            )}
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-14 text-base"
            disabled={loading}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="h-5 w-5" />
            Carica dalla galleria
          </Button>
        </div>

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

        {loading && (
          <p className="text-center text-sm text-muted-foreground">
            🔍 Sto analizzando l'immagine con l'AI…
          </p>
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

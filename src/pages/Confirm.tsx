import { useEffect, useState } from "react";
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
import { X, Plus, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";

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

export default function Confirm() {
  const navigate = useNavigate();
  const [image, setImage] = useState<string | null>(null);
  const [dishName, setDishName] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [newName, setNewName] = useState("");
  const [newCat, setNewCat] = useState("pasta");

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
          <Input
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
            placeholder="Nome del piatto o prodotto"
            className="text-base font-semibold"
          />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Ingredienti con glutine ({ingredients.length})
          </h3>
          {ingredients.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Nessun ingrediente. Aggiungine uno qui sotto.
            </p>
          ) : (
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <Card key={i} className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <p className="font-medium">{ing.name}</p>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {ing.category}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeIngredient(i)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>

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

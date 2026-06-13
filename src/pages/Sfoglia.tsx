import { AppLayout } from "@/components/AppLayout";

const CATEGORIES = [
  { id: "pasta", label: "Pasta", emoji: "🍝" },
  { id: "pane", label: "Pane", emoji: "🍞" },
  { id: "biscotti", label: "Biscotti", emoji: "🍪" },
  { id: "pizza", label: "Pizza", emoji: "🍕" },
  { id: "bevande", label: "Bevande", emoji: "🥤" },
  { id: "dolci", label: "Dolci", emoji: "🍰" },
  { id: "snack", label: "Snack", emoji: "🥨" },
  { id: "cereali", label: "Cereali", emoji: "🌾" },
  { id: "farina", label: "Farina", emoji: "🥐" },
  { id: "altro", label: "Altro", emoji: "✨" },
] as const;

export default function Sfoglia() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="pt-2">
          <h1 className="text-3xl font-medium leading-tight tracking-tight text-foreground">
            Sfoglia
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esplora alternative senza glutine per categoria
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card/80 p-6 backdrop-blur-sm transition active:scale-95"
            >
              <span className="text-3xl" aria-hidden="true">
                {c.emoji}
              </span>
              <span className="text-sm font-medium text-foreground">
                {c.label}
              </span>
            </button>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          La ricerca per categoria sarà disponibile a breve.
        </p>
      </div>
    </AppLayout>
  );
}

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Camera, MousePointerClick, Users, TrendingUp } from "lucide-react";

interface TopProduct {
  product_id: string;
  count: number;
  name: string;
  image_url: string | null;
}

interface DailyStat {
  date: string;
  count: number;
}

export function AnalyticsDashboard() {
  const [loading, setLoading] = useState(true);
  const [totalScans, setTotalScans] = useState(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const [uniqueUsers, setUniqueUsers] = useState(0);
  const [topScanned, setTopScanned] = useState<TopProduct[]>([]);
  const [topClicked, setTopClicked] = useState<TopProduct[]>([]);
  const [dailyScans, setDailyScans] = useState<DailyStat[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      // Fetch all events (paginated to get beyond 1000 limit)
      const allEvents: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data } = await supabase
          .from("analytics_events")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        allEvents.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // Totals
      const scans = allEvents.filter((e) => e.event_type === "scan");
      const clicks = allEvents.filter((e) => e.event_type === "product_click");
      setTotalScans(scans.length);
      setTotalClicks(clicks.length);

      // Unique users
      const userIds = new Set(allEvents.map((e) => e.user_id).filter(Boolean));
      setUniqueUsers(userIds.size);

      // Top scanned dishes (from scan event_data.dish)
      // We don't have product_id for scans, so we show top dishes instead

      // Top clicked products
      const clickCounts = new Map<string, number>();
      clicks.forEach((e) => {
        if (e.product_id) {
          clickCounts.set(e.product_id, (clickCounts.get(e.product_id) || 0) + 1);
        }
      });
      const topClickedIds = [...clickCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (topClickedIds.length > 0) {
        const { data: prods } = await supabase
          .from("products")
          .select("id, name, image_url")
          .in("id", topClickedIds.map(([id]) => id));
        const prodMap = new Map((prods || []).map((p) => [p.id, p]));
        setTopClicked(
          topClickedIds.map(([id, count]) => ({
            product_id: id,
            count,
            name: prodMap.get(id)?.name || "Sconosciuto",
            image_url: prodMap.get(id)?.image_url || null,
          })),
        );
      }

      // Daily scans (last 30 days)
      const dailyMap = new Map<string, number>();
      scans.forEach((e) => {
        const day = e.created_at.slice(0, 10);
        dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
      });
      const sorted = [...dailyMap.entries()].sort().slice(-30);
      setDailyScans(sorted.map(([date, count]) => ({ date, count })));

      // Recent search terms (from scan dish names)
      const dishes = scans
        .map((e) => (e.event_data as any)?.dish)
        .filter(Boolean)
        .slice(0, 20);
      setRecentSearches([...new Set(dishes)].slice(0, 10));

      // Top scanned — use scan event_data to find most common dishes
      // Since scans don't have product_id, we track dish frequency
      const dishCounts = new Map<string, number>();
      scans.forEach((e) => {
        const dish = (e.event_data as any)?.dish;
        if (dish) dishCounts.set(dish, (dishCounts.get(dish) || 0) + 1);
      });
      const topDishes = [...dishCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      setTopScanned(
        topDishes.map(([name, count]) => ({
          product_id: "",
          count,
          name,
          image_url: null,
        })),
      );
    } catch (err) {
      console.error("Analytics load error:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const maxDaily = Math.max(...dailyScans.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="flex flex-col items-center p-4">
          <Camera className="h-5 w-5 text-primary mb-1" />
          <p className="text-2xl font-bold">{totalScans}</p>
          <p className="text-xs text-muted-foreground">Foto scattate</p>
        </Card>
        <Card className="flex flex-col items-center p-4">
          <MousePointerClick className="h-5 w-5 text-primary mb-1" />
          <p className="text-2xl font-bold">{totalClicks}</p>
          <p className="text-xs text-muted-foreground">Click prodotti</p>
        </Card>
        <Card className="flex flex-col items-center p-4">
          <Users className="h-5 w-5 text-primary mb-1" />
          <p className="text-2xl font-bold">{uniqueUsers}</p>
          <p className="text-xs text-muted-foreground">Utenti unici</p>
        </Card>
      </div>

      {/* Daily scans chart (simple bar chart) */}
      {dailyScans.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Scansioni giornaliere (ultimi 30gg)</h3>
          </div>
          <div className="flex items-end gap-[2px] h-24">
            {dailyScans.map((d) => (
              <div
                key={d.date}
                className="flex-1 bg-primary/80 rounded-t-sm hover:bg-primary transition-colors relative group"
                style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: 2 }}
              >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block bg-foreground text-background text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                  {d.date.slice(5)}: {d.count}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Top photographed dishes */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Camera className="h-4 w-4 text-primary" />
          Piatti più fotografati
        </h3>
        {topScanned.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun dato ancora</p>
        ) : (
          <div className="space-y-2">
            {topScanned.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                  <p className="text-sm truncate">{item.name}</p>
                </div>
                <span className="text-sm font-semibold text-primary ml-2">{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Top clicked products */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-primary" />
          Prodotti più cliccati
        </h3>
        {topClicked.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun dato ancora</p>
        ) : (
          <div className="space-y-2">
            {topClicked.map((item, i) => (
              <div key={item.product_id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                <div className="h-8 w-8 shrink-0 rounded bg-muted overflow-hidden">
                  {item.image_url && (
                    <img src={item.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  )}
                </div>
                <p className="text-sm truncate flex-1">{item.name}</p>
                <span className="text-sm font-semibold text-primary">{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent searches */}
      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Ricerche recenti</h3>
        {recentSearches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun dato ancora</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((s, i) => (
              <span
                key={i}
                className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Trash2, Wand2, Download, Edit } from "lucide-react";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";

const CATEGORIES = [
  "pasta", "biscotti", "pane", "farina",
  "dolci", "snack", "cereali", "pizza", "altro",
];

interface Product {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  product_url: string;
  category: string;
  description: string | null;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [canAccess, setCanAccess] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true);

  useEffect(() => {
    async function verifyAdminAccess() {
      if (loading) return;

      if (!user) {
        setCanAccess(false);
        setAccessLoading(false);
        navigate("/auth");
        return;
      }

      setAccessLoading(true);

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      const allowed = !!data;
      setCanAccess(allowed);
      setAccessLoading(false);

      if (!allowed) {
        toast.error("Accesso solo per admin");
        navigate("/");
      }
    }

    void verifyAdminAccess();
  }, [user, loading, navigate]);

  if (loading || accessLoading || !canAccess) {
    return (
      <AppLayout title="Admin">
        <p className="text-center text-muted-foreground">Caricamento…</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Admin">
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="list">Catalogo</TabsTrigger>
          <TabsTrigger value="add">Nuovo</TabsTrigger>
          <TabsTrigger value="import">Importa URL</TabsTrigger>
          <TabsTrigger value="users">Utenti</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard"><AnalyticsDashboard /></TabsContent>
        <TabsContent value="list"><ProductList /></TabsContent>
        <TabsContent value="add"><AddProduct /></TabsContent>
        <TabsContent value="import"><ImportFromUrl /></TabsContent>
        <TabsContent value="users"><UserManager /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}

function ProductList() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    const pageSize = 1000;
    let from = 0;
    const all: any[] = [];
    // Pagina oltre il limite di 1000 righe del client Supabase
    while (true) {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    setItems(all);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm("Eliminare questo prodotto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((arr) => arr.filter((p) => p.id !== id));
  }

  if (loading) return <p>Caricamento…</p>;

  if (editing) {
    return <AddProduct existing={editing} onDone={() => { setEditing(null); load(); }} />;
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter((p) =>
        [p.name, p.brand, p.category, p.description]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q)),
      )
    : items;

  return (
    <div className="space-y-3">
      <Input
        placeholder="Cerca per nome, brand, categoria…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        {filtered.length} di {items.length} prodotti
      </p>
      {filtered.map((p) => (
        <Card key={p.id} className="flex items-center gap-3 p-3">
          <div className="h-14 w-14 shrink-0 rounded bg-muted">
            {p.image_url && (
              <img src={p.image_url} alt="" className="h-full w-full rounded object-cover" loading="lazy" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{p.name}</p>
            <p className="text-xs text-muted-foreground">{p.brand} • {p.category}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => setEditing(p)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </Card>
      ))}
      {filtered.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">Nessun prodotto trovato</p>
      )}
    </div>
  );
}

function AddProduct({ existing, onDone }: { existing?: Product; onDone?: () => void }) {
  const [form, setForm] = useState({
    name: existing?.name || "",
    brand: existing?.brand || "",
    description: existing?.description || "",
    image_url: existing?.image_url || "",
    product_url: existing?.product_url || "",
    category: existing?.category || "altro",
  });
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form, category: form.category as any };
    const { error } = existing
      ? await supabase.from("products").update(payload).eq("id", existing.id)
      : await supabase.from("products").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Prodotto aggiornato" : "Prodotto aggiunto");
    if (onDone) onDone();
    else setForm({ name: "", brand: "", description: "", image_url: "", product_url: "", category: "altro" });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Input placeholder="Nome prodotto *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
      <Input placeholder="URL e-commerce *" type="url" required value={form.product_url} onChange={(e) => setForm({ ...form, product_url: e.target.value })} />
      <Input placeholder="URL immagine" type="url" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
      <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Textarea placeholder="Descrizione" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <Button type="submit" disabled={saving} className="w-full bg-gradient-primary">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {existing ? "Aggiorna" : "Salva"}
      </Button>
    </form>
  );
}

function ImportFromUrl() {
  const [mode, setMode] = useState<"single" | "list">("single");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [single, setSingle] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [defaultCategory, setDefaultCategory] = useState("altro");
  const [importSummary, setImportSummary] = useState<{ found: number; nonGf: number; duplicates: number } | null>(null);
  const [pendingJobs, setPendingJobs] = useState<any[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  function normalizeInputUrl(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
    if (/^tps?:\/\//i.test(trimmed)) return `ht${trimmed}`;
    if (/^ttps?:\/\//i.test(trimmed)) return `h${trimmed}`;
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }

  // Load pending/running jobs on mount
  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    const { data } = await supabase
      .from("import_jobs")
      .select("*")
      .in("status", ["pending", "running", "done", "error"])
      .order("created_at", { ascending: false })
      .limit(20);
    setPendingJobs((data as any[]) || []);
  }

  // Poll for active job completion
  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("id", activeJobId)
        .single();
      if (!data) return;
      if ((data as any).status === "done") {
        clearInterval(interval);
        setActiveJobId(null);
        setLoading(false);
        toast.success("Estrazione completata!");
        processJobResults(data as any);
        loadJobs();
      } else if ((data as any).status === "error") {
        clearInterval(interval);
        setActiveJobId(null);
        setLoading(false);
        toast.error((data as any).error_message || "Errore nell'estrazione");
        loadJobs();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeJobId]);

  async function processJobResults(job: any) {
    let raw: any[] = job.candidates || [];
    const initialCount = raw.length;
    const normalizedUrl = job.url;

    const inputUrlLower = normalizedUrl.toLowerCase();
    const isSearchUrl = /[?&]q=|\/catalogsearch\/|\/search(\b|\/|\?)|\/ricerca/i.test(inputUrlLower);
    const inputIsGfCategory =
      !isSearchUrl &&
      /senza[\s\-_]*glutine|gluten[\s\-]?free|\bsg\b|-sg-|\/sg\//.test(inputUrlLower);

    const isGlutenFree = (c: any) => {
      const hay = `${c?.name || ""} ${c?.description || ""} ${c?.source_url || ""}`.toLowerCase();
      if (/con glutine|contiene glutine/.test(hay)) return false;
      if (inputIsGfCategory) return true;
      if (/senza[\s\-_]*glutine|gluten[\s\-]?free|\bsg\b|\bs\.g\.\b|-sg-|\/sg\//.test(hay)) return true;
      return false;
    };
    const gfFiltered = raw.filter(isGlutenFree);
    const removedNonGf = initialCount - gfFiltered.length;

    const urls = gfFiltered.map((c) => c.source_url).filter(Boolean);
    const names = gfFiltered.map((c) => (c.name || "").trim()).filter(Boolean);
    const existing = new Set<string>();
    const existingNames = new Set<string>();
    if (urls.length) {
      const { data: ex1 } = await supabase
        .from("products")
        .select("product_url,name")
        .in("product_url", urls);
      ex1?.forEach((r: any) => {
        if (r.product_url) existing.add(r.product_url);
        if (r.name) existingNames.add(r.name.toLowerCase().trim());
      });
    }
    if (names.length) {
      const { data: ex2 } = await supabase
        .from("products")
        .select("name")
        .in("name", names);
      ex2?.forEach((r: any) => r.name && existingNames.add(r.name.toLowerCase().trim()));
    }
    const deduped = gfFiltered.filter(
      (c) =>
        !existing.has(c.source_url) &&
        !existingNames.has((c.name || "").toLowerCase().trim()),
    );
    const removedDup = gfFiltered.length - deduped.length;

    setCandidates(deduped);
    setImportSummary({ found: initialCount, nonGf: removedNonGf, duplicates: removedDup });
    setDefaultCategory(job.category || "altro");

    if (!deduped.length) {
      toast.info("Nessun nuovo prodotto senza glutine trovato");
    } else {
      const parts = [`${deduped.length} candidati`];
      if (removedNonGf > 0) parts.push(`${removedNonGf} esclusi (non SG)`);
      if (removedDup > 0) parts.push(`${removedDup} già nel DB`);
      toast.success(parts.join(" · "));
    }
  }

  async function fetchSingle() {
    setLoading(true); setSingle(null);
    try {
      const normalizedUrl = normalizeInputUrl(url);
      const { data, error } = await supabase.functions.invoke("extract-product-url", { body: { url: normalizedUrl } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSingle(data);
      setUrl(normalizedUrl);
    } catch (e: any) {
      toast.error(e?.message || "Errore");
    } finally {
      setLoading(false);
    }
  }

  async function fetchList() {
    setLoading(true); setCandidates([]); setSelected(new Set()); setImportSummary(null);
    try {
      const normalizedUrl = normalizeInputUrl(url);

      // Create a job record first
      const { data: job, error: jobError } = await supabase
        .from("import_jobs")
        .insert({
          url: normalizedUrl,
          category: defaultCategory,
          status: "pending",
        } as any)
        .select()
        .single();
      if (jobError) throw jobError;

      const jobId = (job as any).id;
      setActiveJobId(jobId);
      toast.info("Estrazione avviata in background. Puoi navigare liberamente!");

      // Fire and forget - the edge function will update the job
      supabase.functions.invoke("extract-product-list", {
        body: { url: normalizedUrl, job_id: jobId },
      }).catch((err) => {
        console.error("Edge function invocation error (job will be updated by server):", err);
      });

      setUrl(normalizedUrl);
    } catch (e: any) {
      toast.error(e?.message || "Errore");
      setLoading(false);
    }
  }

  async function loadJobResults(job: any) {
    if (job.status === "done") {
      await processJobResults(job);
    } else if (job.status === "error") {
      toast.error(job.error_message || "Errore nell'estrazione");
    } else {
      // Still running, start polling
      setActiveJobId(job.id);
      setLoading(true);
      toast.info("Estrazione ancora in corso…");
    }
  }

  async function deleteJob(jobId: string) {
    await supabase.from("import_jobs").delete().eq("id", jobId);
    setPendingJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  async function saveSingle() {
    if (!single) return;
    const { error } = await supabase.from("products").insert({
      name: single.name || "Senza nome",
      image_url: single.image,
      description: single.description,
      brand: single.brand,
      product_url: single.source_url,
      category: defaultCategory as any,
    });
    if (error) return toast.error(error.message);
    toast.success("Prodotto salvato");
    setSingle(null); setUrl("");
  }

  async function saveSelected() {
    const rows = candidates
      .filter((_, i) => selected.has(i))
      .map((c) => ({
        name: c.name || "Senza nome",
        image_url: c.image,
        product_url: c.source_url,
        category: defaultCategory as any,
      }));
    if (!rows.length) return toast.error("Seleziona almeno un prodotto");
    const { error } = await supabase.from("products").insert(rows);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} prodotti importati`);
    setCandidates([]); setSelected(new Set()); setUrl("");
  }

  function toggle(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  }

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">URL singolo prodotto</TabsTrigger>
            <TabsTrigger value="list">URL pagina listing</TabsTrigger>
          </TabsList>
          <div className="space-y-3 pt-3">
            <Input
              placeholder="https://e-commerce-senza-glutine.it/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <Select value={defaultCategory} onValueChange={setDefaultCategory}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                onClick={mode === "single" ? fetchSingle : fetchList}
                disabled={!url || loading}
                className="flex-1 bg-gradient-primary"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {loading ? "In corso…" : "Estrai"}
              </Button>
            </div>
          </div>
        </Tabs>
      </Card>

      {/* Active job indicator */}
      {activeJobId && (
        <Card className="flex items-center gap-3 p-3 border-primary/30 bg-primary/5">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Estrazione in corso…</p>
            <p className="text-xs text-muted-foreground">Puoi navigare liberamente, il risultato sarà disponibile quando torni.</p>
          </div>
        </Card>
      )}

      {/* Pending/completed jobs */}
      {pendingJobs.length > 0 && !candidates.length && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Importazioni recenti</p>
          {pendingJobs.map((job) => (
            <Card key={job.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.url}</p>
                <p className="text-xs text-muted-foreground">
                  {job.status === "pending" && "⏳ In attesa…"}
                  {job.status === "running" && "🔄 In corso…"}
                  {job.status === "done" && `✅ Completato · ${(job.candidates || []).length} prodotti trovati`}
                  {job.status === "error" && `❌ Errore: ${job.error_message || "sconosciuto"}`}
                </p>
              </div>
              <div className="flex gap-1">
                {job.status === "done" && (
                  <Button size="sm" variant="outline" onClick={() => loadJobResults(job)}>
                    Visualizza
                  </Button>
                )}
                {(job.status === "pending" || job.status === "running") && (
                  <Button size="sm" variant="outline" onClick={() => loadJobResults(job)}>
                    Segui
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => deleteJob(job.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {single && (
        <Card className="space-y-3 p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Anteprima</p>
          {single.image && <img src={single.image} alt="" className="max-h-40 rounded object-contain" />}
          <Input value={single.name || ""} onChange={(e) => setSingle({ ...single, name: e.target.value })} placeholder="Nome" />
          <Input value={single.brand || ""} onChange={(e) => setSingle({ ...single, brand: e.target.value })} placeholder="Brand" />
          <Button onClick={saveSingle} className="w-full bg-gradient-primary">
            <Download className="h-4 w-4" /> Salva nel DB
          </Button>
        </Card>
      )}

      {(candidates.length > 0 || importSummary) && (
        <div className="space-y-2">
          <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div>
              <p className="text-sm font-semibold">
                {candidates.length} candidati · {selected.size} selezionati
              </p>
              {importSummary && (
                <p className="text-xs text-muted-foreground">
                  {importSummary.found} trovati sul sito
                  {importSummary.nonGf > 0 ? ` · ${importSummary.nonGf} esclusi (non SG)` : ""}
                  {importSummary.duplicates > 0 ? ` · ${importSummary.duplicates} già nel DB` : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelected(
                    selected.size === candidates.length
                      ? new Set()
                      : new Set(candidates.map((_, i) => i)),
                  )
                }
              >
                {selected.size === candidates.length ? "Deseleziona tutti" : "Seleziona tutti"}
              </Button>
              <Button size="sm" onClick={saveSelected} disabled={selected.size === 0}>
                Importa {selected.size}
              </Button>
            </div>
          </div>
          {candidates.map((c, i) => (
            <Card key={i} className="flex items-center gap-3 p-3">
              <Checkbox checked={selected.has(i)} onCheckedChange={() => toggle(i)} />
              <div className="h-12 w-12 shrink-0 rounded bg-muted">
                {c.image && <img src={c.image} alt="" className="h-full w-full rounded object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.source_url}</p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UserManager() {
  const [email, setEmail] = useState("");
  const [admins, setAdmins] = useState<any[]>([]);

  async function load() {
    const { data } = await supabase
      .from("user_roles")
      .select("id, user_id, role, profiles(display_name)")
      .eq("role", "admin");
    setAdmins(data || []);
  }

  useEffect(() => { load(); }, []);

  async function promote() {
    if (!email) return;
    // Look up user by email via profiles join is not direct — use auth admin via SQL? We can't from client.
    // Workaround: ask the user id manually for now via display_name search on profiles.
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, display_name")
      .ilike("display_name", `%${email.split("@")[0]}%`)
      .limit(5);
    if (!prof || prof.length === 0) {
      toast.error("Utente non trovato. L'utente deve registrarsi prima.");
      return;
    }
    if (prof.length > 1) {
      toast.error(`Trovati ${prof.length} utenti, sii più specifico`);
      return;
    }
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: prof[0].id, role: "admin" });
    if (error) return toast.error(error.message);
    toast.success(`${prof[0].display_name} promosso ad admin`);
    setEmail(""); load();
  }

  async function demote(id: string) {
    if (!confirm("Rimuovere il ruolo admin?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <p className="text-sm font-semibold">Promuovi un utente ad admin</p>
        <p className="text-xs text-muted-foreground">
          Inserisci email o display name. L'utente deve essersi già registrato.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="email o nome utente"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button onClick={promote}>Promuovi</Button>
        </div>
      </Card>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Admin attuali ({admins.length})</p>
        {admins.map((a) => (
          <Card key={a.id} className="flex items-center justify-between p-3">
            <p className="text-sm">{a.profiles?.display_name || a.user_id}</p>
            <Button size="sm" variant="ghost" onClick={() => demote(a.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { LogOut, Star, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";

export const Route = createFileRoute("/admin")({
  ssr: false,
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Admin — FreeRun" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Rating = {
  id: string;
  stars: number;
  comment: string | null;
  user_agent: string | null;
  created_at: string;
};

function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      if (data.user) await checkAdmin(data.user.id, setIsAdmin);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) await checkAdmin(session.user.id, setIsAdmin);
      else setIsAdmin(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Caricamento…
      </div>
    );
  }

  if (!user) return <AuthForm />;
  if (!isAdmin) return <NotAuthorized email={user.email ?? ""} />;
  return <Dashboard />;
}

async function checkAdmin(userId: string, set: (v: boolean) => void) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  set(!!data);
}

function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/admin` },
        });
        if (error) throw error;
        toast.success("Account creato. Ora sei loggato.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore di autenticazione");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "signin" ? "Accedi" : "Registrati"} — Admin FreeRun</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Attendere…" : mode === "signin" ? "Accedi" : "Crea account"}
            </Button>
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="w-full text-xs text-muted-foreground underline"
            >
              {mode === "signin"
                ? "Prima volta? Crea l'account admin"
                : "Hai già un account? Accedi"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function NotAuthorized({ email }: { email: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <h1 className="text-xl font-semibold">Accesso negato</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        L'account <strong>{email}</strong> non ha i permessi di amministratore.
      </p>
      <Button variant="outline" onClick={() => supabase.auth.signOut()}>
        <LogOut className="mr-2 h-4 w-4" /> Esci
      </Button>
    </div>
  );
}

function Dashboard() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("app_ratings")
      .select("id, stars, comment, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    else setRatings((data ?? []) as Rating[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const total = ratings.length;
    const avg = total ? ratings.reduce((s, r) => s + r.stars, 0) / total : 0;
    const dist = [0, 0, 0, 0, 0];
    for (const r of ratings) if (r.stars >= 1 && r.stars <= 5) dist[r.stars - 1]++;
    return { total, avg, dist };
  }, [ratings]);

  const onDelete = async (id: string) => {
    if (!confirm("Eliminare questo voto?")) return;
    const { error } = await supabase.from("app_ratings").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setRatings((r) => r.filter((x) => x.id !== id));
      toast.success("Eliminato");
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard voti FreeRun</h1>
          <p className="text-sm text-muted-foreground">
            Voti anonimi ricevuti dagli utenti dell'app.
          </p>
        </div>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>
          <LogOut className="mr-2 h-4 w-4" /> Esci
        </Button>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Totale voti</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Media</CardTitle>
          </CardHeader>
          <CardContent className="flex items-baseline gap-2 text-3xl font-bold">
            {stats.avg.toFixed(2)}
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-500" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Distribuzione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {[5, 4, 3, 2, 1].map((n) => {
              const count = stats.dist[n - 1];
              const pct = stats.total ? (count / stats.total) * 100 : 0;
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-4">{n}</span>
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-500" />
                  <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right tabular-nums">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Elenco voti</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : ratings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ancora nessun voto.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2">Data</th>
                    <th className="p-2">Voto</th>
                    <th className="p-2">Commento</th>
                    <th className="p-2">User Agent</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ratings.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("it-IT")}
                      </td>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1 font-medium">
                          {r.stars}
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-500" />
                        </span>
                      </td>
                      <td className="p-2">{r.comment ?? "—"}</td>
                      <td className="p-2 max-w-[240px] truncate text-xs text-muted-foreground">
                        {r.user_agent ?? "—"}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Elimina voto"
                          onClick={() => onDelete(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Contrast,
  Layers,
  Mountain,
  Search,
  ArrowUpDown,
  StickyNote,
  MapPin,
  Navigation,
  Maximize2,
  Minimize2,
  LocateFixed,
  LocateOff,
} from "lucide-react";
import { MapView, LAYER_LABELS, type LayerKey } from "@/components/MapView";
import { ElevationChart } from "@/components/ElevationChart";
import { StatsPanel } from "@/components/StatsPanel";
import { computeStats, parseGpx, type GpxTrack, type ProfilePoint } from "@/lib/gpx";
import { deleteTrack, listTracks, saveTrack } from "@/lib/storage";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FreeRun" },
      {
        name: "description",
        content:
          "Carica tracce GPX, visualizzale su mappa, ottieni profilo altimetrico, statistiche complete e classificazione di difficoltà. Funziona offline.",
      },
    ],
  }),
  component: HomePage,
});

const PALETTE = ["#2563eb", "#0284c7", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#db2777"];

type SortKey = "date" | "distance" | "ascent" | "duration";

function HomePage() {
  const { theme, setTheme } = useTheme();
  const [tracks, setTracks] = useState<GpxTrack[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<LayerKey>("otm");
  const [hoverPoint, setHoverPoint] = useState<ProfilePoint | null>(null);
  const [cursorLatLng, setCursorLatLng] = useState<{ lat: number; lon: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listTracks().then((all) => {
      setTracks(all);
      if (all.length > 0) setSelectedId(all[0].id);
    });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const added: GpxTrack[] = [];
      for (const f of Array.from(files)) {
        if (!f.name.toLowerCase().endsWith(".gpx")) {
          toast.error(`Formato non supportato: ${f.name}`);
          continue;
        }
        try {
          const text = await f.text();
          const parsed = parseGpx(text, f.name.replace(/\.gpx$/i, ""));
          if (parsed.points.length === 0 && parsed.waypoints.length === 0) {
            toast.error(`GPX vuoto: ${f.name}`);
            continue;
          }
          const track: GpxTrack = {
            id: crypto.randomUUID(),
            name: parsed.name,
            points: parsed.points,
            waypoints: parsed.waypoints,
            createdAt: Date.now(),
            color: PALETTE[(tracks.length + added.length) % PALETTE.length],
            visible: true,
          };
          await saveTrack(track);
          added.push(track);
        } catch (e) {
          console.error(e);
          toast.error(`Errore lettura ${f.name}`);
        }
      }
      if (added.length > 0) {
        setTracks((prev) => [...prev, ...added]);
        setSelectedId(added[added.length - 1].id);
        toast.success(`${added.length} traccia/e caricata/e`);
      }
    },
    [tracks.length],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const toggleVisible = async (id: string) => {
    const next = tracks.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t));
    setTracks(next);
    const t = next.find((x) => x.id === id);
    if (t) await saveTrack(t);
  };

  const removeTrack = async (id: string) => {
    await deleteTrack(id);
    const next = tracks.filter((t) => t.id !== id);
    setTracks(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  };

  const updateNote = async (id: string, note: string) => {
    const next = tracks.map((t) => (t.id === id ? { ...t, note } : t));
    setTracks(next);
    const t = next.find((x) => x.id === id);
    if (t) await saveTrack(t);
  };

  const selected = tracks.find((t) => t.id === selectedId) ?? null;
  const stats = useMemo(() => (selected ? computeStats(selected) : null), [selected]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filt = q ? tracks.filter((t) => t.name.toLowerCase().includes(q)) : tracks;
    const withStats = filt.map((t) => ({ t, s: computeStats(t) }));
    withStats.sort((a, b) => {
      switch (sortKey) {
        case "distance":
          return b.s.distance - a.s.distance;
        case "ascent":
          return b.s.ascent - a.s.ascent;
        case "duration":
          return (b.s.duration ?? 0) - (a.s.duration ?? 0);
        default:
          return b.t.createdAt - a.t.createdAt;
      }
    });
    return withStats;
  }, [tracks, search, sortKey]);

  const hoverEle = hoverPoint ? Math.round(hoverPoint.ele) : null;

  return (
    <div
      className={cn(
        "flex h-screen flex-col bg-background text-foreground",
        dragOver && "ring-4 ring-primary ring-inset",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Toaster theme={theme === "light" ? "light" : "dark"} position="top-right" />

      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-card px-4 py-3 sm:flex sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Mountain className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold sm:text-xl">SentieroLab</h1>
            <p className="truncate text-xs text-muted-foreground">
              Analisi GPX · Offline · Open Source
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Carica GPX</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      </header>

      {/* Body */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr]">
        {/* Sidebar */}
        <aside className="flex min-h-0 flex-col border-b border-border bg-card lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Layers className="h-3.5 w-3.5" /> Layer cartografico
            </div>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value as LayerKey)}
              className="w-full rounded-lg border border-input bg-background px-2 py-2 text-sm"
            >
              {Object.entries(LAYER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Archivio ({tracks.length})
              </div>
            </div>
            <div className="mb-2 flex items-center gap-1">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca…"
                  className="w-full rounded-lg border border-input bg-background py-1.5 pl-7 pr-2 text-sm"
                />
              </div>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                title="Ordina per"
              >
                <option value="date">Data</option>
                <option value="distance">Distanza</option>
                <option value="ascent">Dislivello</option>
                <option value="duration">Durata</option>
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filteredSorted.length === 0 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground transition hover:border-primary hover:text-foreground"
              >
                <Upload className="h-6 w-6" />
                Trascina qui i file GPX
                <br />o clicca per selezionarli
              </button>
            )}
            {filteredSorted.map(({ t, s }) => (
              <div
                key={t.id}
                className={cn(
                  "mb-2 rounded-lg border p-2 transition",
                  selectedId === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:border-primary/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ background: t.color }}
                  />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div className="truncate text-sm font-semibold">{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {(s.distance / 1000).toFixed(1)} km · {Math.round(s.ascent)} m d+ ·{" "}
                      <span className="font-medium">{s.difficulty}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => toggleVisible(t.id)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    title={t.visible ? "Nascondi" : "Mostra"}
                  >
                    {t.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Eliminare "${t.name}"?`)) removeTrack(t.id);
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    title="Elimina"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {selectedId === t.id && (
                  <div className="mt-2 flex items-start gap-1">
                    <StickyNote className="mt-1.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <textarea
                      placeholder="Note personali…"
                      value={t.note ?? ""}
                      onChange={(e) => updateNote(t.id, e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded border border-input bg-background p-1.5 text-xs"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border p-2 text-[10px] text-muted-foreground">
            Dati salvati in locale (IndexedDB). Nessun server.
          </div>
        </aside>

        {/* Map + panel */}
        <main className="grid min-h-0 grid-rows-[1fr_auto]">
          <div className="relative min-h-0">
            <MapView
              tracks={tracks}
              layer={layer}
              hoverPoint={hoverPoint}
              onCursorMove={(lat, lon) => setCursorLatLng({ lat, lon })}
            />
            {/* Cursor info overlay */}
            <div className="pointer-events-none absolute right-3 top-3 z-[500] rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs shadow backdrop-blur">
              {cursorLatLng ? (
                <span className="tabular-nums">
                  {cursorLatLng.lat.toFixed(5)}, {cursorLatLng.lon.toFixed(5)}
                </span>
              ) : (
                <span className="text-muted-foreground">Muovi il cursore sulla mappa</span>
              )}
              {hoverEle !== null && (
                <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
                  {hoverEle} m
                </span>
              )}
            </div>
          </div>

          {/* Bottom panel: elevation + stats */}
          <section className="grid max-h-[55vh] grid-cols-1 gap-3 overflow-y-auto border-t border-border bg-background p-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-h-[180px] rounded-xl border border-border bg-card p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Profilo altimetrico
                </div>
                {selected && (
                  <div className="truncate text-xs text-muted-foreground">{selected.name}</div>
                )}
              </div>
              <div className="h-[180px] sm:h-[220px]">
                {stats ? (
                  <ElevationChart profile={stats.profile} onHover={setHoverPoint} />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Carica una traccia GPX per iniziare
                  </div>
                )}
              </div>
            </div>
            <div>
              {stats ? (
                <StatsPanel stats={stats} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Le statistiche complete della traccia selezionata appariranno qui.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const order: Theme[] = ["light", "dark", "contrast"];
  const next = () => setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Contrast;
  const label =
    theme === "light" ? "Chiaro" : theme === "dark" ? "Scuro" : "Alto contrasto";
  return (
    <button
      onClick={next}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium hover:bg-muted"
      title={`Tema: ${label}`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

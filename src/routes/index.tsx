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
  Menu,
  X,
  Bell,
  AlertTriangle,
  Smartphone,
  Settings,
  ChevronDown,
} from "lucide-react";
import { MapView, LAYER_LABELS, type LayerKey } from "@/components/MapView";
import { ElevationChart } from "@/components/ElevationChart";
import { StatsPanel } from "@/components/StatsPanel";
import { computeStats, distanceToTrack, parseGpx, type GpxTrack, type ProfilePoint } from "@/lib/gpx";
import { deleteTrack, listTracks, saveTrack } from "@/lib/storage";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { TrackSearchDialog } from "@/components/TrackSearchDialog";

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
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lon: number; accuracy?: number } | null>(null);
  const [followUser, setFollowUser] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [offRouteMeters, setOffRouteMeters] = useState(20);
  const [offRouteAlertEnabled, setOffRouteAlertEnabled] = useState(true);
  const [offRoute, setOffRoute] = useState(false);
  const [offRouteDistance, setOffRouteDistance] = useState<number | null>(null);
  const [keepAwake, setKeepAwake] = useState(true);
  const geoWatchRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastBeepRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const ensureAudio = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    } catch {
      // audio not available
    }
  }, []);

  const playAlarm = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    // Two short beeps
    [0, 0.35].forEach((offset) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }, []);

  const releaseWakeLock = useCallback(() => {
    const wl = wakeLockRef.current;
    wakeLockRef.current = null;
    if (wl) void wl.release().catch(() => {});
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      const wl = await navigator.wakeLock.request("screen");
      wakeLockRef.current = wl;
      wl.addEventListener("release", () => {
        if (wakeLockRef.current === wl) wakeLockRef.current = null;
      });
    } catch {
      // wake lock refused (e.g. tab not visible or low battery)
    }
  }, []);

  const stopGeo = useCallback(() => {
    if (geoWatchRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
    }
    geoWatchRef.current = null;
    setFollowUser(false);
    setUserPos(null);
    setOffRoute(false);
    setOffRouteDistance(null);
    releaseWakeLock();
  }, [releaseWakeLock]);

  const startGeo = useCallback(() => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocalizzazione non disponibile su questo dispositivo");
      return;
    }
    ensureAudio();
    if (keepAwake) void requestWakeLock();
    setFollowUser(true);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        toast.error(`Posizione non disponibile: ${err.message}`);
        setFollowUser(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    geoWatchRef.current = id;
  }, [ensureAudio, keepAwake, requestWakeLock]);

  useEffect(() => {
    const onVisibility = () => {
      // Browsers auto-release the wake lock when the page is hidden; re-acquire on return.
      if (
        document.visibilityState === "visible" &&
        keepAwake &&
        geoWatchRef.current !== null &&
        !wakeLockRef.current
      ) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [keepAwake, requestWakeLock]);

  // Toggle wake lock live while tracking is active
  useEffect(() => {
    if (geoWatchRef.current === null) return;
    if (keepAwake && !wakeLockRef.current) void requestWakeLock();
    if (!keepAwake && wakeLockRef.current) releaseWakeLock();
  }, [keepAwake, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    return () => {
      if (geoWatchRef.current !== null && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(geoWatchRef.current);
      }
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

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

  // Off-route detection: alert when the user strays too far from the selected track
  useEffect(() => {
    if (!userPos || !selected || selected.points.length === 0) {
      setOffRoute(false);
      setOffRouteDistance(null);
      return;
    }
    const d = distanceToTrack(userPos, selected.points);
    setOffRouteDistance(d);
    const isOff = d > offRouteMeters;
    setOffRoute(isOff);
    if (isOff && offRouteAlertEnabled) {
      const now = Date.now();
      if (now - lastBeepRef.current > 5000) {
        lastBeepRef.current = now;
        playAlarm();
        toast.warning(`Fuori percorso: ${Math.round(d)} m dalla traccia`, { id: "off-route" });
      }
    } else {
      // reset the throttle so the next departure alerts immediately
      lastBeepRef.current = 0;
    }
  }, [userPos, selected, offRouteMeters, offRouteAlertEnabled, playAlarm]);

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
          <button
            onClick={() => setSidebarOpen(true)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-foreground transition hover:bg-muted"
            title="Apri menu"
            aria-label="Apri menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Mountain className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold sm:text-xl">FreeRun</h1>
            <p className="truncate text-xs text-muted-foreground">
              Analisi GPX · Offline · Open Source
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button
            onClick={() => setSearchOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-muted"
            title="Cerca percorsi online"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Cerca online</span>
          </button>
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

      <TrackSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        userLocation={userPos}
        onImport={async (xml, filename) => {
          const file = new File([xml], filename, { type: "application/gpx+xml" });
          await handleFiles([file]);
        }}
      />

      {/* Body */}
      <div className="relative grid min-h-0 flex-1 grid-cols-1">
        {/* Sidebar drawer */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-[1100] bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-[1101] flex w-[85vw] max-w-[360px] min-h-0 flex-col border-r border-border bg-card transition-transform duration-200",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="text-sm font-semibold">Menu</div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="Chiudi menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            className="flex w-full items-center justify-between border-b border-border p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5" /> Impostazioni
            </span>
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", settingsOpen && "rotate-180")}
            />
          </button>

          {settingsOpen && (
          <>
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
                <Bell className="h-3.5 w-3.5" /> Allarme fuori percorso
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={offRouteAlertEnabled}
                onClick={() => setOffRouteAlertEnabled((v) => !v)}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition",
                  offRouteAlertEnabled ? "bg-primary" : "bg-muted",
                )}
                title={offRouteAlertEnabled ? "Disattiva allarme" : "Attiva allarme"}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all",
                    offRouteAlertEnabled ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={200}
                step={5}
                value={offRouteMeters}
                onChange={(e) => setOffRouteMeters(Number(e.target.value))}
                className="flex-1 accent-primary"
                aria-label="Distanza soglia fuori percorso"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={offRouteMeters}
                  onChange={(e) =>
                    setOffRouteMeters(Math.max(1, Math.min(1000, Number(e.target.value) || 0)))
                  }
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1 text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">m</span>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Suona quando ti allontani oltre {offRouteMeters} m dalla traccia selezionata mentre la
              posizione è attiva.
            </p>
          </div>

          <div className="border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Smartphone className="h-3.5 w-3.5" /> Mantieni schermo acceso
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={keepAwake}
                onClick={() => setKeepAwake((v) => !v)}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition",
                  keepAwake ? "bg-primary" : "bg-muted",
                )}
                title={keepAwake ? "Disattiva" : "Attiva"}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all",
                    keepAwake ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Impedisce il blocco dello schermo mentre segui la posizione, così l&apos;allarme
              continua a funzionare. Nota: con lo schermo del tutto spento o l&apos;app in background
              il browser sospende il tracciamento.
            </p>
          </div>
          </>
          )}

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
          <div
            className={cn(
              "relative min-h-0",
              mapFullscreen && "fixed inset-0 z-[1000] bg-background",
            )}
          >
            <MapView
              tracks={tracks}
              layer={layer}
              hoverPoint={hoverPoint}
              onCursorMove={(lat, lon) => setCursorLatLng({ lat, lon })}
              userPosition={userPos}
              followUser={followUser}
            />
            {/* Map controls */}
            <div className="absolute left-3 top-3 z-[500] flex flex-col gap-2">
              <button
                onClick={() => (userPos ? stopGeo() : startGeo())}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 py-2 text-xs font-medium shadow backdrop-blur hover:bg-muted",
                  userPos && "border-primary text-primary",
                )}
                title={userPos ? "Interrompi tracciamento posizione" : "Mostra la mia posizione"}
              >
                {userPos ? <LocateFixed className="h-4 w-4" /> : <LocateOff className="h-4 w-4" />}
                <span className="hidden sm:inline">
                  {userPos ? "La mia posizione" : "Posizione"}
                </span>
              </button>
              {userPos && (
                <button
                  onClick={() => setFollowUser((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 py-2 text-xs font-medium shadow backdrop-blur hover:bg-muted",
                    followUser && "border-primary text-primary",
                  )}
                  title={followUser ? "Smetti di seguire" : "Segui posizione"}
                >
                  <Navigation className="h-4 w-4" />
                  <span className="hidden sm:inline">Segui</span>
                </button>
              )}
              <button
                onClick={() => setMapFullscreen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2.5 py-2 text-xs font-medium shadow backdrop-blur hover:bg-muted"
                title={mapFullscreen ? "Riduci mappa" : "Mappa a tutto schermo"}
              >
                {mapFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">
                  {mapFullscreen ? "Riduci" : "Schermo intero"}
                </span>
              </button>
            </div>
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
            {/* Off-route banner */}
            {offRoute && offRouteDistance !== null && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-[600] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground shadow-lg">
                <AlertTriangle className="h-4 w-4" />
                Fuori percorso · {Math.round(offRouteDistance)} m
              </div>
            )}
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

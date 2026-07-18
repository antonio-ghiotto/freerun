import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  MapPin,
  Loader2,
  Star,
  StarOff,
  Download,
  ExternalLink,
  X,
  Locate,
  Filter,
  SlidersHorizontal,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { providerManager } from "@/providers";
import type {
  Activity,
  ResultFilters,
  SortKey,
  TrackResult,
} from "@/providers/types";
import { applyFilters, sortResults, type ProviderStatus } from "@/providers/ProviderManager";
import { LocalFolderProvider } from "@/providers/LocalFolderProvider";
import { geocode, type GeocodeSuggestion } from "@/lib/geocode";
import { getFavorites, toggleFavorite } from "@/lib/favorites";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fired when the user imports a track; receives the GPX xml + a filename hint. */
  onImport: (gpxXml: string, filename: string) => Promise<void> | void;
  /** Optional user location to enable "nearby" quickly. */
  userLocation?: { lat: number; lon: number } | null;
  /** Called when the user hovers a result to preview it on the underlying map. */
  onPreview?: (gpxXml: string, name: string) => void;
  onClearPreview?: () => void;
}

const ACTIVITIES: { id: Activity; label: string }[] = [
  { id: "hiking", label: "Escursionismo" },
  { id: "trail", label: "Trail" },
  { id: "mtb", label: "MTB" },
  { id: "cycling", label: "Bici" },
  { id: "gravel", label: "Gravel" },
  { id: "walking", label: "Camminata" },
  { id: "running", label: "Corsa" },
  { id: "skiing", label: "Sci" },
];

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "relevance", label: "Rilevanza" },
  { id: "proximity", label: "Vicinanza" },
  { id: "length", label: "Lunghezza" },
  { id: "elevation", label: "Dislivello" },
  { id: "duration", label: "Durata" },
  { id: "rating", label: "Valutazione" },
  { id: "name", label: "Nome" },
  { id: "provider", label: "Provider" },
];

export function TrackSearchDialog({
  open,
  onClose,
  onImport,
  userLocation,
  onPreview,
  onClearPreview,
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<GeocodeSuggestion | null>(null);
  const [radiusKm, setRadiusKm] = useState(15);
  const [activity, setActivity] = useState<Activity | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey>("proximity");
  const [filters, setFilters] = useState<ResultFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<TrackResult[]>([]);
  const [status, setStatus] = useState<ProviderStatus[]>([]);
  const [searching, setSearching] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => getFavorites());
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const previewCache = useRef(new Map<string, string>());

  // Auto-suggest addresses as the user types.
  useEffect(() => {
    if (!open) return;
    if (query.length < 3 || selectedLocation?.displayName === query) {
      setSuggestions([]);
      return;
    }
    geocodeAbortRef.current?.abort();
    const ac = new AbortController();
    geocodeAbortRef.current = ac;
    const t = setTimeout(async () => {
      try {
        const list = await geocode(query, ac.signal);
        setSuggestions(list);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, open, selectedLocation?.displayName]);

  const runSearch = async (loc: { lat: number; lon: number; name?: string }, kind: "byLocation" | "nearby") => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);
    setResults([]);
    setStatus([]);
    try {
      await providerManager.searchAll(
        kind,
        {
          lat: loc.lat,
          lon: loc.lon,
          name: loc.name,
          radiusKm,
          activity,
          limit: 40,
        },
        ({ status, results }) => {
          setStatus(status);
          setResults(results);
        },
        ac.signal,
      );
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async () => {
    if (!selectedLocation && suggestions[0]) {
      setSelectedLocation(suggestions[0]);
      setQuery(suggestions[0].displayName);
      await runSearch(suggestions[0], "byLocation");
      return;
    }
    if (selectedLocation) {
      await runSearch(selectedLocation, "byLocation");
    } else {
      toast.error("Inserisci una località o usa 'Vicino a me'");
    }
  };

  const handleNearby = async () => {
    if (!userLocation) {
      toast.error("Attiva la posizione dalla mappa per usare 'Vicino a me'");
      return;
    }
    setSelectedLocation({ displayName: "La mia posizione", ...userLocation });
    setQuery("La mia posizione");
    await runSearch(userLocation, "nearby");
  };

  const filteredSorted = useMemo(() => {
    const origin = selectedLocation ?? userLocation ?? undefined;
    return sortResults(applyFilters(results, filters), sortKey, origin ?? undefined);
  }, [results, filters, sortKey, selectedLocation, userLocation]);

  const handleImport = async (r: TrackResult) => {
    setDownloadingId(r.id);
    try {
      const provider = providerManager.get(r.provider);
      if (!provider) throw new Error("Provider non trovato");
      const gpx = previewCache.current.get(r.id) ?? (await provider.downloadTrack(r));
      previewCache.current.set(r.id, gpx);
      await onImport(gpx, `${r.title.replace(/[^\w\s.-]+/g, "_")}.gpx`);
      toast.success(`Importato: ${r.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import fallito");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleHover = async (r: TrackResult | null) => {
    setHoveredId(r?.id ?? null);
    if (!r) {
      onClearPreview?.();
      return;
    }
    if (!onPreview) return;
    const cached = previewCache.current.get(r.id);
    if (cached) {
      onPreview(cached, r.title);
      return;
    }
    try {
      const provider = providerManager.get(r.provider);
      if (!provider) return;
      const gpx = await provider.downloadTrack(r);
      previewCache.current.set(r.id, gpx);
      // Only apply preview if still hovered
      if (hoveredIdRef.current === r.id) onPreview(gpx, r.title);
    } catch {
      /* silent */
    }
  };

  const hoveredIdRef = useRef<string | null>(null);
  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  const togglePickFolder = async () => {
    const local = providerManager.get("localfolder") as LocalFolderProvider | undefined;
    if (!local) return;
    if (!local.available) {
      toast.error(local.unavailableReason || "Non disponibile");
      return;
    }
    try {
      await local.pickFolder();
      toast.success("Cartella collegata");
      setStatus((s) => s.map((x) => (x.id === "localfolder" ? { ...x, enabled: true } : x)));
    } catch {
      /* user cancelled */
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center bg-black/60 p-2 sm:p-6">
      <div className="flex h-full max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Cerca percorsi online</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted"
            title="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedLocation(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Città, montagna, sentiero, coordinate…"
                className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-2 text-sm"
              />
              {suggestions.length > 0 && !selectedLocation && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.lat},${s.lon}`}
                      onClick={() => {
                        setSelectedLocation(s);
                        setQuery(s.displayName);
                        setSuggestions([]);
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
                    >
                      {s.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground">Raggio</label>
              <input
                type="number"
                min={1}
                max={200}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="text-xs text-muted-foreground">km</span>
            </div>
            <select
              value={activity ?? ""}
              onChange={(e) => setActivity((e.target.value || undefined) as Activity | undefined)}
              className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Tutte le attività</option>
              {ACTIVITIES.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <button
              onClick={handleSearch}
              disabled={searching}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Cerca
            </button>
            <button
              onClick={handleNearby}
              disabled={searching || !userLocation}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
              title={userLocation ? "Cerca vicino a me" : "Attiva la posizione per usarlo"}
            >
              <Locate className="h-4 w-4" /> Vicino a me
            </button>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted",
                showFilters && "border-primary text-primary",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" /> Filtri
            </button>
          </div>

          {/* Provider chips */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {providerManager.list().map((p) => {
              const s = status.find((x) => x.id === p.id);
              const active = p.enabled && p.available;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (p.id === "localfolder" && !(p as LocalFolderProvider).isReady()) {
                      togglePickFolder();
                      return;
                    }
                    providerManager.setEnabled(p.id, !p.enabled);
                    setStatus((prev) =>
                      prev.length
                        ? prev.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x))
                        : prev,
                    );
                  }}
                  disabled={!p.available}
                  title={p.unavailableReason}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                    !p.available && "opacity-50",
                  )}
                >
                  {p.id === "localfolder" && <FolderOpen className="h-3 w-3" />}
                  {p.name}
                  {s?.loading && <Loader2 className="h-3 w-3 animate-spin" />}
                  {s && !s.loading && s.count > 0 && (
                    <span className="rounded-full bg-primary/20 px-1.5 text-[10px]">{s.count}</span>
                  )}
                  {s?.error && <AlertTriangle className="h-3 w-3 text-destructive" />}
                </button>
              );
            })}
          </div>

          {showFilters && (
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-4">
              <RangeField
                label="Distanza (km)"
                min={filters.minDistance}
                max={filters.maxDistance}
                onMin={(v) => setFilters((f) => ({ ...f, minDistance: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, maxDistance: v }))}
              />
              <RangeField
                label="D+ (m)"
                min={filters.minElevation}
                max={filters.maxElevation}
                onMin={(v) => setFilters((f) => ({ ...f, minElevation: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, maxElevation: v }))}
              />
              <RangeField
                label="Durata (h)"
                min={filters.minDuration}
                max={filters.maxDuration}
                onMin={(v) => setFilters((f) => ({ ...f, minDuration: v }))}
                onMax={(v) => setFilters((f) => ({ ...f, maxDuration: v }))}
              />
              <div>
                <label className="mb-1 block font-medium">Ordina per</label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="w-full rounded border border-input bg-background px-2 py-1"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Results list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {searching && results.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Ricerca in corso…
            </div>
          )}
          {!searching && results.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <Filter className="h-8 w-8 opacity-40" />
              Inserisci una località e premi <b>Cerca</b>, oppure usa <b>Vicino a me</b>.
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {filteredSorted.map((r) => (
              <ResultCard
                key={r.id}
                r={r}
                fav={favorites.includes(r.id)}
                onToggleFav={() => {
                  toggleFavorite(r.id);
                  setFavorites(getFavorites());
                }}
                onImport={() => handleImport(r)}
                onHover={() => handleHover(r)}
                onLeave={() => handleHover(null)}
                downloading={downloadingId === r.id}
              />
            ))}
          </div>
        </div>

        {/* Footer summary */}
        <div className="flex items-center justify-between border-t border-border p-2 text-[11px] text-muted-foreground">
          <span>
            {filteredSorted.length} risultati{results.length !== filteredSorted.length && ` (di ${results.length})`}
          </span>
          <span>
            Provider: {status.filter((s) => s.enabled && s.available).length} attivi ·
            {" "}errori: {status.filter((s) => s.error).length}
          </span>
        </div>
      </div>
    </div>
  );
}

function RangeField({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min?: number;
  max?: number;
  onMin: (v: number | undefined) => void;
  onMax: (v: number | undefined) => void;
}) {
  return (
    <div>
      <label className="mb-1 block font-medium">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="min"
          value={min ?? ""}
          onChange={(e) => onMin(e.target.value === "" ? undefined : Number(e.target.value))}
          className="w-full rounded border border-input bg-background px-2 py-1"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="number"
          placeholder="max"
          value={max ?? ""}
          onChange={(e) => onMax(e.target.value === "" ? undefined : Number(e.target.value))}
          className="w-full rounded border border-input bg-background px-2 py-1"
        />
      </div>
    </div>
  );
}

function ResultCard({
  r,
  fav,
  onToggleFav,
  onImport,
  onHover,
  onLeave,
  downloading,
}: {
  r: TrackResult;
  fav: boolean;
  onToggleFav: () => void;
  onImport: () => void;
  onHover: () => void;
  onLeave: () => void;
  downloading: boolean;
}) {
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition hover:border-primary/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{r.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {r.providerLabel}
            {r.activity && ` · ${r.activity}`}
          </div>
        </div>
        <button
          onClick={onToggleFav}
          title={fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
          className="rounded p-1 text-muted-foreground hover:text-yellow-500"
        >
          {fav ? <Star className="h-4 w-4 fill-yellow-400 text-yellow-500" /> : <StarOff className="h-4 w-4" />}
        </button>
      </div>
      {r.description && (
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{r.description}</p>
      )}
      <div className="flex flex-wrap gap-2 text-[11px]">
        {r.distance !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {(r.distance / 1000).toFixed(1)} km
          </span>
        )}
        {r.elevationGain !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5">D+ {Math.round(r.elevationGain)} m</span>
        )}
        {r.estimatedTime !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {Math.round(r.estimatedTime / 60)} min
          </span>
        )}
        {r.difficulty && (
          <span className="rounded bg-muted px-1.5 py-0.5 uppercase">{r.difficulty}</span>
        )}
      </div>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <button
          onClick={onImport}
          disabled={downloading}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Importa
        </button>
        {r.detailsUrl && (
          <a
            href={r.detailsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Sito
          </a>
        )}
      </div>
    </div>
  );
}

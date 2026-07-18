import type { ResultFilters, SortKey, TrackProvider, TrackResult } from "./types";

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  enabled: boolean;
  loading: boolean;
  error?: string;
  count: number;
  unavailableReason?: string;
}

export interface SearchProgress {
  status: ProviderStatus[];
  results: TrackResult[];
}

export class ProviderManager {
  private providers: TrackProvider[] = [];
  constructor(providers: TrackProvider[]) {
    this.providers = providers;
  }

  list(): TrackProvider[] {
    return this.providers;
  }

  get(id: string): TrackProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  setEnabled(id: string, enabled: boolean) {
    const p = this.get(id);
    if (p) p.enabled = enabled;
  }

  /**
   * Run searches in parallel across enabled+available providers.
   * Calls onProgress after each provider settles so the UI can stream results.
   */
  async searchAll(
    kind: "byLocation" | "nearby",
    params: {
      lat: number;
      lon: number;
      name?: string;
      radiusKm: number;
      activity?: import("./types").Activity;
      limit?: number;
    },
    onProgress: (p: SearchProgress) => void,
    signal?: AbortSignal,
  ): Promise<TrackResult[]> {
    const active = this.providers.filter((p) => p.enabled && p.available);
    const status: ProviderStatus[] = this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      available: p.available,
      enabled: p.enabled,
      loading: p.enabled && p.available,
      count: 0,
      unavailableReason: p.unavailableReason,
    }));
    const byId = new Map(status.map((s) => [s.id, s]));
    const all: TrackResult[] = [];
    onProgress({ status: [...status], results: [] });

    await Promise.allSettled(
      active.map(async (p) => {
        try {
          const rows =
            kind === "byLocation"
              ? await p.searchByLocation({
                  location: { lat: params.lat, lon: params.lon, name: params.name },
                  radiusKm: params.radiusKm,
                  activity: params.activity,
                  limit: params.limit,
                  signal,
                })
              : await p.searchNearby({
                  center: { lat: params.lat, lon: params.lon, name: params.name },
                  radiusKm: params.radiusKm,
                  activity: params.activity,
                  limit: params.limit,
                  signal,
                });
          const s = byId.get(p.id)!;
          s.loading = false;
          s.count = rows.length;
          all.push(...rows);
          onProgress({ status: [...status], results: dedupe(all) });
        } catch (e) {
          const s = byId.get(p.id)!;
          s.loading = false;
          s.error = e instanceof Error ? e.message : "Errore";
          onProgress({ status: [...status], results: dedupe(all) });
        }
      }),
    );
    return dedupe(all);
  }
}

/** Deduplicate by (title lowercase + approx bbox center) across providers. */
export function dedupe(results: TrackResult[]): TrackResult[] {
  const seen = new Map<string, TrackResult>();
  for (const r of results) {
    const cx = r.boundingBox
      ? ((r.boundingBox.minLat + r.boundingBox.maxLat) / 2).toFixed(2) +
        "," +
        ((r.boundingBox.minLon + r.boundingBox.maxLon) / 2).toFixed(2)
      : r.location
        ? r.location.lat.toFixed(2) + "," + r.location.lon.toFixed(2)
        : "";
    const key = r.title.trim().toLowerCase() + "|" + cx;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, r);
    } else {
      // Prefer entry with a gpxUrl or more metadata.
      const score = (x: TrackResult) =>
        (x.gpxUrl ? 2 : 0) + (x.distance ? 1 : 0) + (x.elevationGain ? 1 : 0);
      if (score(r) > score(prev)) seen.set(key, r);
    }
  }
  return [...seen.values()];
}

export function applyFilters(results: TrackResult[], f: ResultFilters): TrackResult[] {
  return results.filter((r) => {
    if (f.activities?.length && r.activity && !f.activities.includes(r.activity)) return false;
    if (f.difficulty?.length && r.difficulty && !f.difficulty.includes(r.difficulty)) return false;
    if (f.providers?.length && !f.providers.includes(r.provider)) return false;
    if (r.distance !== undefined) {
      const km = r.distance / 1000;
      if (f.minDistance !== undefined && km < f.minDistance) return false;
      if (f.maxDistance !== undefined && km > f.maxDistance) return false;
    }
    if (r.elevationGain !== undefined) {
      if (f.minElevation !== undefined && r.elevationGain < f.minElevation) return false;
      if (f.maxElevation !== undefined && r.elevationGain > f.maxElevation) return false;
    }
    if (r.estimatedTime !== undefined) {
      const h = r.estimatedTime / 3600;
      if (f.minDuration !== undefined && h < f.minDuration) return false;
      if (f.maxDuration !== undefined && h > f.maxDuration) return false;
    }
    if (f.minRating !== undefined && (r.rating ?? 0) < f.minRating) return false;
    return true;
  });
}

export function sortResults(
  results: TrackResult[],
  key: SortKey,
  origin?: { lat: number; lon: number },
): TrackResult[] {
  const copy = [...results];
  const num = (n?: number) => (n === undefined ? Infinity : n);
  copy.sort((a, b) => {
    switch (key) {
      case "distance":
      case "length":
        return num(a.distance) - num(b.distance);
      case "elevation":
        return num(a.elevationGain) - num(b.elevationGain);
      case "duration":
        return num(a.estimatedTime) - num(b.estimatedTime);
      case "popularity":
        return num(b.downloads) - num(a.downloads);
      case "rating":
        return (b.rating ?? 0) - (a.rating ?? 0);
      case "name":
        return a.title.localeCompare(b.title);
      case "provider":
        return a.providerLabel.localeCompare(b.providerLabel);
      case "proximity":
        if (!origin) return 0;
        return dist(a, origin) - dist(b, origin);
      default:
        return 0;
    }
  });
  return copy;
}

function dist(r: TrackResult, o: { lat: number; lon: number }): number {
  const p = r.location ?? centerOf(r);
  if (!p) return Infinity;
  const dLat = p.lat - o.lat;
  const dLon = p.lon - o.lon;
  return dLat * dLat + dLon * dLon;
}

function centerOf(r: TrackResult): { lat: number; lon: number } | null {
  if (!r.boundingBox) return null;
  return {
    lat: (r.boundingBox.minLat + r.boundingBox.maxLat) / 2,
    lon: (r.boundingBox.minLon + r.boundingBox.maxLon) / 2,
  };
}

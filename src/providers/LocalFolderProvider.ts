// Reads .gpx files from a user-chosen local folder via File System Access API.
// Falls back to unavailable on browsers that don't support it (Firefox/Safari).
import type {
  SearchByLocationParams,
  SearchNearbyParams,
  TrackProvider,
  TrackResult,
} from "./types";
import { haversine, parseGpx, bboxOf } from "@/lib/gpx";

interface Entry {
  handle: FileSystemFileHandle;
  name: string;
  path: string;
  cachedText?: string;
  cachedResult?: TrackResult;
}

async function collectGpx(
  dir: FileSystemDirectoryHandle,
  base = "",
  out: Entry[] = [],
): Promise<Entry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const [name, handle] of (dir as any).entries()) {
    const path = base ? `${base}/${name}` : name;
    if (handle.kind === "file" && /\.gpx$/i.test(name)) {
      out.push({ handle, name, path });
    } else if (handle.kind === "directory") {
      await collectGpx(handle as FileSystemDirectoryHandle, path, out);
    }
  }
  return out;
}

async function parseEntry(entry: Entry): Promise<TrackResult | null> {
  if (entry.cachedResult) return entry.cachedResult;
  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    entry.cachedText = text;
    const parsed = parseGpx(text, entry.name.replace(/\.gpx$/i, ""));
    const bb = bboxOf(parsed.points);
    let distance = 0;
    for (let i = 1; i < parsed.points.length; i++) {
      distance += haversine(parsed.points[i - 1], parsed.points[i]);
    }
    const center = bb
      ? { lat: (bb[0][0] + bb[1][0]) / 2, lon: (bb[0][1] + bb[1][1]) / 2 }
      : undefined;
    const res: TrackResult = {
      id: `localfolder:${entry.path}`,
      provider: "localfolder",
      providerLabel: "Cartella locale",
      remoteId: entry.path,
      title: parsed.name || entry.name,
      description: entry.path,
      distance,
      location: center ? { ...center, name: entry.path } : undefined,
      boundingBox: bb
        ? { minLat: bb[0][0], minLon: bb[0][1], maxLat: bb[1][0], maxLon: bb[1][1] }
        : undefined,
    };
    entry.cachedResult = res;
    return res;
  } catch {
    return null;
  }
}

export class LocalFolderProvider implements TrackProvider {
  id = "localfolder";
  name = "Cartella locale";
  enabled = false;
  available = true;
  unavailableReason?: string;

  private dir: FileSystemDirectoryHandle | null = null;
  private entries: Entry[] = [];

  constructor() {
    if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
      this.available = false;
      this.unavailableReason =
        "File System Access API non supportata da questo browser. Usa Chrome/Edge desktop.";
    }
  }

  isReady() {
    return this.dir !== null;
  }

  async pickFolder(): Promise<void> {
    if (!this.available) throw new Error(this.unavailableReason);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dir = await (window as any).showDirectoryPicker();
    this.dir = dir;
    this.entries = await collectGpx(dir);
    this.enabled = true;
  }

  private async allResults(signal?: AbortSignal): Promise<TrackResult[]> {
    if (!this.dir) return [];
    const out: TrackResult[] = [];
    for (const e of this.entries) {
      if (signal?.aborted) break;
      const r = await parseEntry(e);
      if (r) out.push(r);
    }
    return out;
  }

  async searchByLocation(params: SearchByLocationParams) {
    return this.filter(await this.allResults(params.signal), params);
  }
  async searchNearby(params: SearchNearbyParams) {
    return this.filter(await this.allResults(params.signal), {
      location: params.center,
      radiusKm: params.radiusKm,
      activity: params.activity,
      limit: params.limit,
    });
  }

  private filter(
    results: TrackResult[],
    params: { location?: { lat: number; lon: number }; radiusKm?: number },
  ): TrackResult[] {
    if (!params.location || !params.radiusKm) return results;
    const radiusM = params.radiusKm * 1000;
    return results.filter((r) => {
      if (!r.location) return true;
      const d = haversine(params.location!, r.location);
      return d <= radiusM;
    });
  }

  async downloadTrack(result: TrackResult): Promise<string> {
    const entry = this.entries.find((e) => e.path === result.remoteId);
    if (!entry) throw new Error("File non trovato");
    if (entry.cachedText) return entry.cachedText;
    const file = await entry.handle.getFile();
    return file.text();
  }
}

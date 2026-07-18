// Waymarked Trails provides free public APIs for OSM route relations.
// hiking / cycling / mtb / riding / skating / slopes each have their own subdomain.
// API: https://hiking.waymarkedtrails.org/api/v1/
// GPX export: /api/v1/details/relation/{id}/geometry/gpx
import type {
  Activity,
  SearchByLocationParams,
  SearchNearbyParams,
  TrackProvider,
  TrackResult,
} from "./types";

type WmtActivity = "hiking" | "cycling" | "mtb" | "riding" | "slopes";

const HOSTS: Record<WmtActivity, string> = {
  hiking: "https://hiking.waymarkedtrails.org",
  cycling: "https://cycling.waymarkedtrails.org",
  mtb: "https://mtb.waymarkedtrails.org",
  riding: "https://riding.waymarkedtrails.org",
  slopes: "https://slopes.waymarkedtrails.org",
};

function activitiesFor(a?: Activity): WmtActivity[] {
  switch (a) {
    case "cycling":
    case "gravel":
      return ["cycling"];
    case "mtb":
      return ["mtb"];
    case "hiking":
    case "trail":
    case "walking":
    case "running":
      return ["hiking"];
    case "skiing":
      return ["slopes"];
    default:
      return ["hiking", "cycling", "mtb"];
  }
}

function toActivity(w: WmtActivity): Activity {
  if (w === "cycling") return "cycling";
  if (w === "mtb") return "mtb";
  if (w === "slopes") return "skiing";
  return "hiking";
}

function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - dLat,
    minLon: lon - dLon,
    maxLat: lat + dLat,
    maxLon: lon + dLon,
  };
}

async function fetchList(
  host: string,
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
  limit: number,
  signal?: AbortSignal,
) {
  // WMT expects bbox=minLon,minLat,maxLon,maxLat
  const params = new URLSearchParams({
    bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    limit: String(limit),
  });
  const url = `${host}/api/v1/list/by_area?${params.toString()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Waymarked Trails ${res.status}`);
  const data = (await res.json()) as {
    results?: Array<{
      id: number;
      name?: string;
      ref?: string;
      group?: string;
      symbol?: string;
    }>;
  };
  return data.results ?? [];
}

function toResult(host: string, wmt: WmtActivity, r: { id: number; name?: string; ref?: string; symbol?: string }): TrackResult {
  const title = r.name || (r.ref ? `Percorso ${r.ref}` : `Relazione OSM ${r.id}`);
  return {
    id: `waymarkedtrails-${wmt}:${r.id}`,
    provider: "waymarkedtrails",
    providerLabel: "Waymarked Trails",
    remoteId: `${wmt}:${r.id}`,
    title,
    description: r.ref ? `Ref: ${r.ref}` : undefined,
    activity: toActivity(wmt),
    thumbnail: r.symbol,
    gpxUrl: `${host}/api/v1/details/relation/${r.id}/geometry/gpx`,
    detailsUrl: `${host}/#route?id=${r.id}`,
  };
}

async function runSearch(
  center: { lat: number; lon: number },
  radiusKm: number,
  activity: Activity | undefined,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<TrackResult[]> {
  const bbox = bboxAround(center.lat, center.lon, radiusKm);
  const wmts = activitiesFor(activity);
  const per = Math.max(5, Math.floor(limit / wmts.length));
  const chunks = await Promise.allSettled(
    wmts.map(async (w) => {
      const host = HOSTS[w];
      const rows = await fetchList(host, bbox, per, signal);
      return rows.map((r) => toResult(host, w, r));
    }),
  );
  return chunks.flatMap((c) => (c.status === "fulfilled" ? c.value : []));
}

export class WaymarkedTrailsProvider implements TrackProvider {
  id = "waymarkedtrails";
  name = "Waymarked Trails (OSM)";
  enabled = true;
  available = true;

  async searchByLocation({
    location,
    radiusKm,
    activity,
    limit = 40,
    signal,
  }: SearchByLocationParams) {
    return runSearch(location, radiusKm, activity, limit, signal);
  }

  async searchNearby({ center, radiusKm, activity, limit = 40, signal }: SearchNearbyParams) {
    return runSearch(center, radiusKm, activity, limit, signal);
  }

  async downloadTrack(result: TrackResult, signal?: AbortSignal): Promise<string> {
    if (!result.gpxUrl) throw new Error("URL GPX non disponibile");
    const res = await fetch(result.gpxUrl, { signal });
    if (!res.ok) throw new Error(`Download fallito (${res.status})`);
    return res.text();
  }
}

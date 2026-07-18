// Overpass API — searches OSM route relations directly and assembles GPX from the
// relation geometry. Complementary to Waymarked Trails: catches routes filtered
// out of WMT and works for any activity tag.
import type {
  Activity,
  SearchByLocationParams,
  SearchNearbyParams,
  TrackProvider,
  TrackResult,
} from "./types";

// Multiple public Overpass mirrors — the primary occasionally rejects CORS or times
// out, so we fall through the list until one responds.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

function routeFilter(a?: Activity): string {
  switch (a) {
    case "mtb":
      return '["route"="mtb"]';
    case "cycling":
    case "gravel":
      return '["route"~"^(bicycle|cycling)$"]';
    case "hiking":
    case "trail":
    case "walking":
    case "running":
      return '["route"~"^(hiking|foot|walking)$"]';
    case "skiing":
      return '["route"~"^(ski|piste)$"]';
    default:
      return '["route"~"^(hiking|foot|walking|bicycle|mtb)$"]';
  }
}

function bboxAround(lat: number, lon: number, km: number) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon] as const;
}

interface OverpassElement {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: Array<{
    type: string;
    ref: number;
    role?: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
}

async function overpass<T>(query: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return (await res.json()) as T;
}

function toActivity(tags?: Record<string, string>): Activity {
  const r = tags?.route;
  if (r === "mtb") return "mtb";
  if (r === "bicycle" || r === "cycling") return "cycling";
  if (r === "ski" || r === "piste") return "skiing";
  return "hiking";
}

function toResult(el: OverpassElement): TrackResult {
  const tags = el.tags ?? {};
  const title = tags.name || tags.ref || `OSM route ${el.id}`;
  const b = el.bounds;
  return {
    id: `overpass:${el.id}`,
    provider: "overpass",
    providerLabel: "OpenStreetMap",
    remoteId: String(el.id),
    title,
    description: tags.description || tags["description:it"] || tags.ref,
    activity: toActivity(tags),
    boundingBox: b
      ? { minLat: b.minlat, minLon: b.minlon, maxLat: b.maxlat, maxLon: b.maxlon }
      : undefined,
    detailsUrl: `https://www.openstreetmap.org/relation/${el.id}`,
  };
}

async function searchArea(
  center: { lat: number; lon: number },
  radiusKm: number,
  activity: Activity | undefined,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<TrackResult[]> {
  const [minLat, minLon, maxLat, maxLon] = bboxAround(center.lat, center.lon, radiusKm);
  const filter = routeFilter(activity);
  const q = `[out:json][timeout:25];
relation${filter}(${minLat},${minLon},${maxLat},${maxLon});
out tags bb ${limit};`;
  const data = await overpass<{ elements: OverpassElement[] }>(q, signal);
  return data.elements.map(toResult);
}

// GPX assembly: fetch geometry for a single relation and stitch its ways.
async function fetchGeometry(id: string, signal?: AbortSignal): Promise<Array<Array<{ lat: number; lon: number }>>> {
  const q = `[out:json][timeout:60];
relation(${id});
out geom;`;
  const data = await overpass<{ elements: OverpassElement[] }>(q, signal);
  const rel = data.elements.find((e) => e.type === "relation" && String(e.id) === id);
  if (!rel?.members) throw new Error("Relazione senza geometria");
  return rel.members
    .filter((m) => m.type === "way" && m.geometry && m.geometry.length > 0)
    .map((m) => m.geometry as Array<{ lat: number; lon: number }>);
}

function segmentsToGpx(name: string, segments: Array<Array<{ lat: number; lon: number }>>): string {
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
  const trksegs = segments
    .map(
      (seg) =>
        `<trkseg>${seg.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"/>`).join("")}</trkseg>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FreeRun/Overpass" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${esc(name)}</name>${trksegs}</trk>
</gpx>`;
}

export class OverpassProvider implements TrackProvider {
  id = "overpass";
  name = "OpenStreetMap (Overpass)";
  enabled = true;
  available = true;

  async searchByLocation({ location, radiusKm, activity, limit = 30, signal }: SearchByLocationParams) {
    return searchArea(location, radiusKm, activity, limit, signal);
  }
  async searchNearby({ center, radiusKm, activity, limit = 30, signal }: SearchNearbyParams) {
    return searchArea(center, radiusKm, activity, limit, signal);
  }
  async downloadTrack(result: TrackResult, signal?: AbortSignal): Promise<string> {
    const segs = await fetchGeometry(result.remoteId, signal);
    return segmentsToGpx(result.title, segs);
  }
}

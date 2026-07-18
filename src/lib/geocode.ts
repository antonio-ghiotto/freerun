// Nominatim (OpenStreetMap) forward geocoding.
export interface GeocodeSuggestion {
  displayName: string;
  lat: number;
  lon: number;
  type?: string;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export async function geocode(
  query: string,
  signal?: AbortSignal,
  limit = 6,
): Promise<GeocodeSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `${ENDPOINT}?format=jsonv2&addressdetails=0&limit=${limit}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    signal,
    headers: { "Accept-Language": "it,en" },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    type?: string;
  }>;
  return data.map((r) => ({
    displayName: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    type: r.type,
  }));
}

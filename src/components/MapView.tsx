import { useEffect, useRef } from "react";
import L from "leaflet";
import type { GpxTrack, ProfilePoint } from "@/lib/gpx";
import { bboxOf } from "@/lib/gpx";

export type LayerKey = "osm" | "otm" | "cyclosm" | "sat";

const LAYERS: Record<LayerKey, { url: string; attribution: string; maxZoom: number; subdomains?: string }> = {
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  otm: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
    subdomains: "abc",
  },
  cyclosm: {
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution: "© CyclOSM | © OpenStreetMap contributors",
    maxZoom: 20,
    subdomains: "abc",
  },
  sat: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

interface Props {
  tracks: GpxTrack[];
  layer: LayerKey;
  hoverPoint: ProfilePoint | null;
  onCursorMove?: (lat: number, lon: number) => void;
  userPosition?: { lat: number; lon: number; accuracy?: number } | null;
  followUser?: boolean;
}

export function MapView({ tracks, layer, hoverPoint, onCursorMove, userPosition, followUser }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const trackLayersRef = useRef<Map<string, L.LayerGroup>>(new Map());
  const cursorMarkerRef = useRef<L.CircleMarker | null>(null);
  const userMarkerRef = useRef<L.LayerGroup | null>(null);
  const lastBoundsSigRef = useRef<string>("");

  // init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [45.9, 10.5],
      zoom: 6,
      zoomControl: true,
    });
    mapRef.current = map;
    const l = LAYERS[layer];
    tileRef.current = L.tileLayer(l.url, {
      attribution: l.attribution,
      maxZoom: l.maxZoom,
      subdomains: l.subdomains as any,
    }).addTo(map);

    map.on("mousemove", (e) => {
      onCursorMove?.(e.latlng.lat, e.latlng.lng);
    });

    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // change base layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const l = LAYERS[layer];
    tileRef.current = L.tileLayer(l.url, {
      attribution: l.attribution,
      maxZoom: l.maxZoom,
      subdomains: l.subdomains as any,
    }).addTo(map);
  }, [layer]);

  // render tracks
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = trackLayersRef.current;

    // remove tracks no longer present or invisible
    for (const [id, group] of existing) {
      const t = tracks.find((x) => x.id === id);
      if (!t || !t.visible) {
        map.removeLayer(group);
        existing.delete(id);
      }
    }

    // add or update
    for (const t of tracks) {
      if (!t.visible) continue;
      if (existing.has(t.id)) continue;
      const group = L.layerGroup();
      const latlngs = t.points.map((p) => [p.lat, p.lon] as [number, number]);
      // white halo for contrast
      L.polyline(latlngs, {
        color: "#ffffff",
        weight: 8,
        opacity: 0.85,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(group);
      // main track (blue, more visible)
      L.polyline(latlngs, {
        color: t.color,
        weight: 5,
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(group);
      // start/end markers
      if (latlngs.length > 0) {
        L.circleMarker(latlngs[0], { radius: 6, color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 })
          .bindTooltip("Partenza")
          .addTo(group);
        L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 })
          .bindTooltip("Arrivo")
          .addTo(group);
      }
      // waypoints
      for (const w of t.waypoints) {
        const container = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = w.name ?? "Waypoint";
        container.appendChild(title);
        if (w.sym) {
          container.appendChild(document.createElement("br"));
          const em = document.createElement("em");
          em.textContent = w.sym;
          container.appendChild(em);
        }
        if (w.ele) {
          container.appendChild(document.createElement("br"));
          container.appendChild(
            document.createTextNode(`Quota: ${Math.round(w.ele)} m`),
          );
        }
        if (w.desc) {
          container.appendChild(document.createElement("br"));
          container.appendChild(document.createTextNode(w.desc));
        }
        L.marker([w.lat, w.lon]).bindPopup(container).addTo(group);
      }
      group.addTo(map);
      existing.set(t.id, group);
    }

    // auto-fit to visible tracks
    const visiblePts = tracks.filter((t) => t.visible).flatMap((t) => t.points);
    const bb = bboxOf(visiblePts);
    if (bb) {
      const sig = JSON.stringify(bb) + tracks.filter((t) => t.visible).map((t) => t.id).join(",");
      if (sig !== lastBoundsSigRef.current) {
        map.fitBounds(bb as any, { padding: [30, 30] });
        lastBoundsSigRef.current = sig;
      }
    }
  }, [tracks]);

  // hover marker from elevation chart
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (cursorMarkerRef.current) {
      map.removeLayer(cursorMarkerRef.current);
      cursorMarkerRef.current = null;
    }
    if (hoverPoint) {
      cursorMarkerRef.current = L.circleMarker([hoverPoint.lat, hoverPoint.lon], {
        radius: 8,
        color: "#f59e0b",
        weight: 3,
        fillColor: "#fbbf24",
        fillOpacity: 1,
      }).addTo(map);
    }
  }, [hoverPoint]);

  // user position (blue dot with accuracy circle)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) {
      map.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }
    if (userPosition) {
      const g = L.layerGroup();
      if (userPosition.accuracy && userPosition.accuracy > 0) {
        L.circle([userPosition.lat, userPosition.lon], {
          radius: userPosition.accuracy,
          color: "#2563eb",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.15,
        }).addTo(g);
      }
      L.circleMarker([userPosition.lat, userPosition.lon], {
        radius: 8,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      })
        .bindTooltip("La mia posizione")
        .addTo(g);
      g.addTo(map);
      userMarkerRef.current = g;
      if (followUser) {
        map.setView([userPosition.lat, userPosition.lon], Math.max(map.getZoom(), 15));
      }
    }
  }, [userPosition, followUser]);

  return <div ref={containerRef} className="h-full w-full" style={{ minHeight: 300 }} />;
}

export const LAYER_LABELS: Record<LayerKey, string> = {
  osm: "OpenStreetMap",
  otm: "OpenTopoMap",
  cyclosm: "CyclOSM (escursionistica)",
  sat: "Satellite (Esri)",
};

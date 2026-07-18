// GPX parser + geo helpers (client-side, no dependencies)

export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: number; // epoch ms
}

export interface GpxWaypoint {
  lat: number;
  lon: number;
  ele?: number;
  name?: string;
  desc?: string;
  sym?: string; // symbol type (rifugio, fontana, bivacco...)
}

export interface GpxTrack {
  id: string;
  name: string;
  points: GpxPoint[];
  waypoints: GpxWaypoint[];
  createdAt: number;
  color: string;
  visible: boolean;
  note?: string;
  raw?: string; // original xml for re-export (optional)
}

const R = 6371000; // earth radius meters

export function haversine(a: GpxPoint, b: GpxPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseGpx(xml: string, fallbackName = "Traccia"): {
  name: string;
  points: GpxPoint[];
  waypoints: GpxWaypoint[];
} {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("File GPX non valido");

  const nameEl =
    doc.querySelector("trk > name") ||
    doc.querySelector("metadata > name") ||
    doc.querySelector("rte > name");
  const name = nameEl?.textContent?.trim() || fallbackName;

  const points: GpxPoint[] = [];
  const trkpts = doc.getElementsByTagName("trkpt");
  for (let i = 0; i < trkpts.length; i++) {
    const p = trkpts[i];
    const lat = parseFloat(p.getAttribute("lat") || "");
    const lon = parseFloat(p.getAttribute("lon") || "");
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const eleEl = p.getElementsByTagName("ele")[0];
    const timeEl = p.getElementsByTagName("time")[0];
    points.push({
      lat,
      lon,
      ele: eleEl ? parseFloat(eleEl.textContent || "") : undefined,
      time: timeEl ? Date.parse(timeEl.textContent || "") : undefined,
    });
  }

  // Also support <rtept> if no trkpt
  if (points.length === 0) {
    const rtepts = doc.getElementsByTagName("rtept");
    for (let i = 0; i < rtepts.length; i++) {
      const p = rtepts[i];
      const lat = parseFloat(p.getAttribute("lat") || "");
      const lon = parseFloat(p.getAttribute("lon") || "");
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const eleEl = p.getElementsByTagName("ele")[0];
      points.push({
        lat,
        lon,
        ele: eleEl ? parseFloat(eleEl.textContent || "") : undefined,
      });
    }
  }

  const waypoints: GpxWaypoint[] = [];
  const wpts = doc.getElementsByTagName("wpt");
  for (let i = 0; i < wpts.length; i++) {
    const w = wpts[i];
    const lat = parseFloat(w.getAttribute("lat") || "");
    const lon = parseFloat(w.getAttribute("lon") || "");
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    waypoints.push({
      lat,
      lon,
      ele: parseFloat(w.getElementsByTagName("ele")[0]?.textContent || "") || undefined,
      name: w.getElementsByTagName("name")[0]?.textContent?.trim() || undefined,
      desc: w.getElementsByTagName("desc")[0]?.textContent?.trim() || undefined,
      sym: w.getElementsByTagName("sym")[0]?.textContent?.trim() || undefined,
    });
  }

  return { name, points, waypoints };
}

// ------- Elevation smoothing (moving average) -------
function smooth(values: number[], win = 5): number[] {
  const out: number[] = new Array(values.length);
  const half = Math.floor(win / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

export interface ProfilePoint {
  index: number;
  distance: number; // meters from start
  ele: number;
  slope: number; // -1..1
  lat: number;
  lon: number;
  time?: number;
}

export interface TrackStats {
  distance: number; // m
  ascent: number;
  descent: number;
  eleMin: number;
  eleMax: number;
  slopeMaxUp: number;
  slopeMaxDown: number;
  longestClimb: number; // m
  longestDescent: number; // m
  waypoints: number;
  duration?: number; // ms
  movingTime?: number;
  stoppedTime?: number;
  avgSpeed?: number; // m/s
  profile: ProfilePoint[];
  naismithHours: number;
  timePrincipiante: number;
  timeIntermedio: number;
  timeEsperto: number;
  difficulty: "T" | "E" | "EE" | "EEA";
}

export function computeStats(track: GpxTrack): TrackStats {
  const pts = track.points;
  const n = pts.length;
  const profile: ProfilePoint[] = [];
  if (n === 0) {
    return {
      distance: 0, ascent: 0, descent: 0, eleMin: 0, eleMax: 0,
      slopeMaxUp: 0, slopeMaxDown: 0, longestClimb: 0, longestDescent: 0,
      waypoints: track.waypoints.length, profile: [], naismithHours: 0,
      timePrincipiante: 0, timeIntermedio: 0, timeEsperto: 0, difficulty: "T",
    };
  }

  const rawEle = pts.map((p) => p.ele ?? 0);
  const ele = smooth(rawEle, 7);

  let dist = 0;
  let ascent = 0;
  let descent = 0;
  let eleMin = ele[0];
  let eleMax = ele[0];
  let slopeMaxUp = 0;
  let slopeMaxDown = 0;
  let longestClimb = 0;
  let longestDescent = 0;
  let curClimb = 0;
  let curDescent = 0;

  profile.push({ index: 0, distance: 0, ele: ele[0], slope: 0, lat: pts[0].lat, lon: pts[0].lon, time: pts[0].time });

  for (let i = 1; i < n; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    dist += seg;
    const dEle = ele[i] - ele[i - 1];
    const slope = seg > 0 ? dEle / seg : 0;
    if (dEle > 0) {
      ascent += dEle;
      curClimb += seg;
      if (curDescent > longestDescent) longestDescent = curDescent;
      curDescent = 0;
    } else if (dEle < 0) {
      descent += -dEle;
      curDescent += seg;
      if (curClimb > longestClimb) longestClimb = curClimb;
      curClimb = 0;
    }
    if (ele[i] < eleMin) eleMin = ele[i];
    if (ele[i] > eleMax) eleMax = ele[i];
    if (slope > slopeMaxUp) slopeMaxUp = slope;
    if (slope < slopeMaxDown) slopeMaxDown = slope;
    profile.push({
      index: i, distance: dist, ele: ele[i], slope,
      lat: pts[i].lat, lon: pts[i].lon, time: pts[i].time,
    });
  }
  if (curClimb > longestClimb) longestClimb = curClimb;
  if (curDescent > longestDescent) longestDescent = curDescent;

  // times
  const firstT = pts.find((p) => p.time)?.time;
  const lastT = [...pts].reverse().find((p) => p.time)?.time;
  const duration = firstT && lastT ? lastT - firstT : undefined;

  let movingTime: number | undefined;
  let stoppedTime: number | undefined;
  if (duration) {
    movingTime = 0;
    stoppedTime = 0;
    for (let i = 1; i < n; i++) {
      const t1 = pts[i - 1].time;
      const t2 = pts[i].time;
      if (!t1 || !t2) continue;
      const dt = t2 - t1;
      const seg = haversine(pts[i - 1], pts[i]);
      const speed = dt > 0 ? seg / (dt / 1000) : 0; // m/s
      if (speed > 0.3) movingTime += dt;
      else stoppedTime += dt;
    }
  }

  const avgSpeed = duration && duration > 0 ? dist / (duration / 1000) : undefined;

  // Naismith: 1h / 5km + 1h / 600m d+
  const naismithHours = dist / 1000 / 5 + ascent / 600;
  const timePrincipiante = naismithHours * 1.4;
  const timeIntermedio = naismithHours;
  const timeEsperto = naismithHours * 0.8;

  // Difficulty classification (rule-of-thumb basata su CAI)
  const km = dist / 1000;
  const slopePctUp = slopeMaxUp * 100;
  let difficulty: TrackStats["difficulty"] = "T";
  if (km <= 8 && ascent < 300 && slopePctUp < 15) difficulty = "T";
  else if (km <= 20 && ascent < 1000 && slopePctUp < 30) difficulty = "E";
  else if (ascent < 1600 && slopePctUp < 45) difficulty = "EE";
  else difficulty = "EEA";

  return {
    distance: dist, ascent, descent, eleMin, eleMax,
    slopeMaxUp, slopeMaxDown, longestClimb, longestDescent,
    waypoints: track.waypoints.length, duration, movingTime, stoppedTime,
    avgSpeed, profile, naismithHours, timePrincipiante, timeIntermedio, timeEsperto,
    difficulty,
  };
}

// Distance (meters) from a point to the closest segment of a track polyline.
function pointToSegment(
  p: { lat: number; lon: number },
  a: GpxPoint,
  b: GpxPoint,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat0 = toRad(p.lat);
  const projX = (lon: number) => toRad(lon) * Math.cos(lat0) * R;
  const projY = (lat: number) => toRad(lat) * R;
  const px = projX(p.lon);
  const py = projY(p.lat);
  const ax = projX(a.lon);
  const ay = projY(a.lat);
  const bx = projX(b.lon);
  const by = projY(b.lat);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export function distanceToTrack(
  pt: { lat: number; lon: number },
  points: GpxPoint[],
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return haversine(pt as GpxPoint, points[0]);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = pointToSegment(pt, points[i - 1], points[i]);
    if (d < min) min = d;
  }
  return min;
}

export function bboxOf(points: GpxPoint[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLat = points[0].lat, maxLat = points[0].lat, minLon = points[0].lon, maxLon = points[0].lon;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return [[minLat, minLon], [maxLat, maxLon]];
}

export function fmtDuration(ms?: number): string {
  if (!ms || ms < 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function fmtHours(h: number): string {
  if (!isFinite(h) || h <= 0) return "—";
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return hh > 0 ? `${hh}h ${mm.toString().padStart(2, "0")}m` : `${mm}m`;
}

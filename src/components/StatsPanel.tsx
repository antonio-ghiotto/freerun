import type { TrackStats } from "@/lib/gpx";
import { fmtDuration, fmtHours } from "@/lib/gpx";

interface Props {
  stats: TrackStats;
}

function Cell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StatsPanel({ stats }: Props) {
  const km = (stats.distance / 1000).toFixed(2);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Cell label="Distanza" value={`${km} km`} />
        <Cell label="Dislivello +" value={`${Math.round(stats.ascent)} m`} />
        <Cell label="Dislivello −" value={`${Math.round(stats.descent)} m`} />
        <Cell label="Quota min" value={`${Math.round(stats.eleMin)} m`} />
        <Cell label="Quota max" value={`${Math.round(stats.eleMax)} m`} />
        <Cell label="Waypoint" value={stats.waypoints} />
        <Cell label="Pend. max ↑" value={`${(stats.slopeMaxUp * 100).toFixed(1)}%`} />
        <Cell label="Pend. max ↓" value={`${(stats.slopeMaxDown * 100).toFixed(1)}%`} />
        <Cell label="Salita più lunga" value={`${(stats.longestClimb / 1000).toFixed(2)} km`} />
        <Cell label="Discesa più lunga" value={`${(stats.longestDescent / 1000).toFixed(2)} km`} />
        <Cell label="Durata GPX" value={fmtDuration(stats.duration)} />
        <Cell
          label="Vel. media"
          value={stats.avgSpeed ? `${(stats.avgSpeed * 3.6).toFixed(1)} km/h` : "—"}
        />
        <Cell label="Movimento" value={fmtDuration(stats.movingTime)} />
        <Cell label="Sosta" value={fmtDuration(stats.stoppedTime)} />
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tempo di percorrenza stimato (Naismith)
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-muted-foreground">Principiante</div>
            <div className="font-semibold">{fmtHours(stats.timePrincipiante)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Intermedio</div>
            <div className="font-semibold">{fmtHours(stats.timeIntermedio)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Esperto</div>
            <div className="font-semibold">{fmtHours(stats.timeEsperto)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

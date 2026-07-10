import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProfilePoint } from "@/lib/gpx";

interface Props {
  profile: ProfilePoint[];
  onHover: (p: ProfilePoint | null) => void;
}

export function ElevationChart({ profile, onHover }: Props) {
  if (!profile.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Nessun dato altimetrico disponibile
      </div>
    );
  }
  const data = profile.map((p) => ({
    d: +(p.distance / 1000).toFixed(3),
    ele: Math.round(p.ele),
    slope: +(p.slope * 100).toFixed(1),
    _p: p,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={data}
        margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
        onMouseMove={(e: any) => {
          const p = e?.activePayload?.[0]?.payload?._p;
          if (p) onHover(p);
        }}
        onMouseLeave={() => onHover(null)}
      >
        <defs>
          <linearGradient id="ele" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.85} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="d"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => `${v} km`}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
        />
        <YAxis
          dataKey="ele"
          tickFormatter={(v) => `${v} m`}
          stroke="var(--color-muted-foreground)"
          fontSize={11}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-popover-foreground)",
            fontSize: 12,
          }}
          labelFormatter={(v) => `${v} km`}
          formatter={(val: any, name: string) => {
            if (name === "ele") return [`${val} m`, "Quota"];
            if (name === "slope") return [`${val}%`, "Pendenza"];
            return [val, name];
          }}
        />
        <Area
          type="monotone"
          dataKey="ele"
          stroke="var(--color-primary)"
          strokeWidth={2}
          fill="url(#ele)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

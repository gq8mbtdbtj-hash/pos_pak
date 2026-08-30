import type { GoalCheckin } from "../services/api";

type Props = {
  checkins: GoalCheckin[];
  startValue: number;
  targetValue: number;
  unit?: string;
  currentValue: number;
  gap: number;
};

/** Solid line of measured values + dashed horizontal target + gap readout. */
export default function CheckinChart({
  checkins,
  startValue,
  targetValue,
  unit,
  currentValue,
  gap,
}: Props) {
  const points = [...checkins]
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => ({ date: c.date, value: Number(c.value ?? c.progress ?? startValue) }));

  const w = 320;
  const h = 140;
  const pad = { t: 16, r: 12, b: 28, l: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const vals = [...points.map((p) => p.value), startValue, targetValue];
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const span = maxV - minV || 1;

  const xAt = (i: number, n: number) =>
    pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - ((v - minV) / span) * innerH;

  const line =
    points.length === 0
      ? ""
      : points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i, points.length).toFixed(1)} ${yAt(p.value).toFixed(1)}`)
          .join(" ");

  const targetY = yAt(targetValue);
  const gapAbs = Math.abs(gap);
  const gapLabel =
    gap > 0.0001 ? `还差 ${formatNum(gapAbs)}${unit ?? ""}` : gap < -0.0001 ? `超出 ${formatNum(gapAbs)}${unit ?? ""}` : "已达目标";

  return (
    <div className="checkin-chart">
      <div className="checkin-chart__meta">
        <span>
          当前 {formatNum(currentValue)}
          {unit ?? ""}
        </span>
        <span className="muted">目标 {formatNum(targetValue)}{unit ?? ""}</span>
        <strong className={gap <= 0 ? "amount-income" : ""}>{gapLabel}</strong>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="checkin-chart__svg" role="img" aria-label="打卡折线">
        <line
          x1={pad.l}
          x2={w - pad.r}
          y1={targetY}
          y2={targetY}
          className="checkin-chart__target"
        />
        {line ? <path d={line} className="checkin-chart__line" fill="none" /> : null}
        {points.map((p, i) => (
          <circle
            key={`${p.date}-${i}`}
            cx={xAt(i, points.length)}
            cy={yAt(p.value)}
            r={3.2}
            className="checkin-chart__dot"
          />
        ))}
        {points.length > 0 ? (
          <text x={pad.l} y={h - 8} className="checkin-chart__axis">
            {points[0].date.slice(5)}
          </text>
        ) : null}
        {points.length > 1 ? (
          <text x={w - pad.r} y={h - 8} textAnchor="end" className="checkin-chart__axis">
            {points[points.length - 1].date.slice(5)}
          </text>
        ) : null}
      </svg>
      {points.length === 0 ? (
        <p className="muted hint" style={{ marginTop: "0.35rem" }}>
          尚无打卡点；今日填入实测值后会出现折线。起点 {formatNum(startValue)}
          {unit ?? ""}
        </p>
      ) : null}
    </div>
  );
}

function formatNum(n: number) {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

import type { GoalCheckin } from "../services/api";

type Props = {
  checkins: GoalCheckin[];
  /** Goal target value (e.g. 76). */
  targetValue: number;
  /** Goal deadline YYYY-MM-DD; X-axis end. */
  targetDate?: string;
  unit?: string;
};

type Pt = { date: string; value: number; day: number };

function parseDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t / 86400000 : null;
}

function todayDay(): number {
  const n = new Date();
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 86400000;
}

function formatDayLabel(day: number): string {
  const d = new Date(day * 86400000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/**
 * 目标打卡折线：
 * - 起点 = 首次打卡实测值（不是创建时填的 0）
 * - 目标 = 任务 targetValue
 * - X 轴 = 首次打卡日 → 截止日（无截止则取今天与末次打卡较晚者）
 */
export default function CheckinChart({
  checkins,
  targetValue,
  targetDate,
  unit,
}: Props) {
  const unitSuffix = unit?.trim() ? unit.trim() : "";

  const points: Pt[] = [...checkins]
    .map((c) => {
      const day = parseDay(c.date);
      const value = Number(c.value);
      if (day == null || !Number.isFinite(value)) return null;
      return { date: c.date, value, day };
    })
    .filter((p): p is Pt => p != null)
    .sort((a, b) => a.day - b.day);

  if (!Number.isFinite(targetValue)) {
    return (
      <div className="checkin-chart">
        <p className="muted hint">任务缺少有效目标值，无法绘图。</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="checkin-chart">
        <div className="checkin-chart__meta">
          <span className="muted">
            目标 {formatNum(targetValue)}
            {unitSuffix}
          </span>
        </div>
        <p className="muted hint">
          尚无打卡。首次实测将登记为起点（例如目标 {formatNum(targetValue)}
          {unitSuffix}，首次 82.8 → 起点 82.8）。
        </p>
      </div>
    );
  }

  const startValue = points[0].value;
  const current = points[points.length - 1].value;
  const prev = points.length > 1 ? points[points.length - 2].value : null;
  const x0 = points[0].day;
  const deadlineDay = targetDate ? parseDay(targetDate) : null;
  const x1 = Math.max(
    points[points.length - 1].day,
    deadlineDay ?? -Infinity,
    todayDay(),
  );
  // Ensure axis has span even if first day == end
  const xEnd = x1 > x0 ? x1 : x0 + 1;

  const { remaining, gapLabel, closerLabel } = gapAnalysis(
    startValue,
    targetValue,
    current,
    prev,
    unitSuffix,
  );

  const w = 360;
  const h = 210;
  const pad = { t: 18, r: 16, b: 40, l: 46 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const vals = [startValue, targetValue, ...points.map((p) => p.value)];
  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);
  const rawSpan = maxV - minV;
  const padAmt = rawSpan === 0 ? Math.max(Math.abs(maxV) * 0.08, 0.5) : rawSpan * 0.12;
  minV -= padAmt;
  maxV += padAmt;
  const span = maxV - minV || 1;

  const xAtDay = (day: number) =>
    pad.l + ((day - x0) / (xEnd - x0)) * innerW;
  const yAt = (v: number) => pad.t + innerH - ((v - minV) / span) * innerH;

  const yTicks = uniqueTicks([maxV, targetValue, startValue, minV, current]).filter(
    (v) => v >= minV - 1e-9 && v <= maxV + 1e-9,
  );

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xAtDay(p.day).toFixed(1)} ${yAt(p.value).toFixed(1)}`,
    )
    .join(" ");

  const axisY0 = pad.t + innerH;
  const axisX0 = pad.l;
  const closerGood = closerLabel?.includes("更近");
  const xLabels = buildXLabels(x0, xEnd, deadlineDay);

  return (
    <div className="checkin-chart">
      <div className="checkin-chart__meta">
        <span>
          起点 {formatNum(startValue)}
          {unitSuffix}
          <span className="muted">（首次打卡）</span>
        </span>
        <span>
          当前 {formatNum(current)}
          {unitSuffix}
        </span>
        <span>
          目标 {formatNum(targetValue)}
          {unitSuffix}
        </span>
        <strong className={remaining <= 0 ? "amount-income" : "amount-expense"}>
          {gapLabel}
        </strong>
        {closerLabel ? (
          <span className={closerGood ? "amount-income" : "amount-expense"}>
            {closerLabel}
          </span>
        ) : null}
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="checkin-chart__svg"
        role="img"
        aria-label="目标打卡折线"
      >
        <line
          x1={axisX0}
          y1={pad.t}
          x2={axisX0}
          y2={axisY0}
          className="checkin-chart__axis-line"
        />
        <line
          x1={axisX0}
          y1={axisY0}
          x2={w - pad.r}
          y2={axisY0}
          className="checkin-chart__axis-line"
        />

        {yTicks.map((v) => {
          const y = yAt(v);
          const isTarget = Math.abs(v - targetValue) < 1e-9;
          return (
            <g key={`y-${v}`}>
              <line
                x1={axisX0 - 4}
                y1={y}
                x2={axisX0}
                y2={y}
                className="checkin-chart__tick"
              />
              <text
                x={axisX0 - 6}
                y={y + 3}
                textAnchor="end"
                className={
                  isTarget
                    ? "checkin-chart__axis checkin-chart__axis--target"
                    : "checkin-chart__axis"
                }
              >
                {formatNum(v)}
              </text>
            </g>
          );
        })}

        <line
          x1={axisX0}
          x2={w - pad.r}
          y1={yAt(targetValue)}
          y2={yAt(targetValue)}
          className="checkin-chart__target"
        />
        <line
          x1={axisX0}
          x2={w - pad.r}
          y1={yAt(startValue)}
          y2={yAt(startValue)}
          className="checkin-chart__start"
        />

        <path d={line} className="checkin-chart__line" fill="none" />
        {points.map((p) => (
          <circle
            key={`${p.date}-${p.value}`}
            cx={xAtDay(p.day)}
            cy={yAt(p.value)}
            r={3.4}
            className="checkin-chart__dot"
          />
        ))}

        {deadlineDay != null && deadlineDay >= x0 && deadlineDay <= xEnd ? (
          <line
            x1={xAtDay(deadlineDay)}
            x2={xAtDay(deadlineDay)}
            y1={pad.t}
            y2={axisY0}
            className="checkin-chart__deadline"
          />
        ) : null}

        {xLabels.map((lab) => (
          <text
            key={`x-${lab.day}-${lab.text}`}
            x={xAtDay(lab.day)}
            y={h - 12}
            textAnchor="middle"
            className={
              lab.emphasis
                ? "checkin-chart__axis checkin-chart__axis--target"
                : "checkin-chart__axis"
            }
          >
            {lab.text}
          </text>
        ))}
      </svg>
      <div className="checkin-chart__legend muted">
        <span className="checkin-chart__legend-item checkin-chart__legend-item--line">实测</span>
        <span className="checkin-chart__legend-item checkin-chart__legend-item--target">目标</span>
        <span className="checkin-chart__legend-item checkin-chart__legend-item--start">起点</span>
        {deadlineDay != null ? (
          <span className="checkin-chart__legend-item checkin-chart__legend-item--deadline">
            截止
          </span>
        ) : null}
      </div>
    </div>
  );
}

function buildXLabels(
  x0: number,
  xEnd: number,
  deadlineDay: number | null,
): { day: number; text: string; emphasis?: boolean }[] {
  const span = xEnd - x0;
  const out: { day: number; text: string; emphasis?: boolean }[] = [
    { day: x0, text: formatDayLabel(x0) },
  ];
  if (span > 14) {
    out.push({ day: x0 + span / 2, text: formatDayLabel(x0 + span / 2) });
  }
  out.push({ day: xEnd, text: formatDayLabel(xEnd) });
  if (deadlineDay != null && deadlineDay > x0 + 1 && deadlineDay < xEnd - 1) {
    out.push({
      day: deadlineDay,
      text: `截止 ${formatDayLabel(deadlineDay)}`,
      emphasis: true,
    });
  }
  // Dedupe close labels
  out.sort((a, b) => a.day - b.day);
  const deduped: typeof out = [];
  for (const lab of out) {
    if (deduped.every((x) => Math.abs(x.day - lab.day) > span * 0.08 || span < 3)) {
      deduped.push(lab);
    }
  }
  return deduped;
}

function gapAnalysis(
  start: number,
  target: number,
  current: number,
  prev: number | null,
  unit: string,
) {
  const toward = target - start;
  const remaining =
    Math.abs(toward) < 1e-12
      ? target - current
      : toward > 0
        ? target - current
        : current - target;

  let gapLabel: string;
  if (Math.abs(remaining) < 1e-9) gapLabel = "已达目标";
  else if (remaining > 0) gapLabel = `还差 ${formatNum(remaining)}${unit}`;
  else gapLabel = `超出 ${formatNum(-remaining)}${unit}`;

  let closerLabel: string | null = null;
  if (prev != null && Number.isFinite(prev)) {
    const dist = (v: number) => Math.abs(target - v);
    const dNow = dist(current);
    const dPrev = dist(prev);
    if (Math.abs(dNow - dPrev) < 1e-9) closerLabel = "与上次持平";
    else if (dNow < dPrev) closerLabel = "比上次更近";
    else closerLabel = "比上次更远";
  }

  return { remaining, gapLabel, closerLabel };
}

function uniqueTicks(vals: number[]): number[] {
  const sorted = [...vals].filter((v) => Number.isFinite(v)).sort((a, b) => b - a);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.every((x) => Math.abs(x - v) > 1e-6)) out.push(v);
  }
  if (out.length <= 5) return out;
  return [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}

function formatNum(n: number) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (Number.isInteger(n)) return String(n);
  if (a >= 100) return (Math.round(n * 10) / 10).toString();
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, "") || "0";
}

import type { GoalCheckin } from "../services/api";

type Props = {
  checkins: GoalCheckin[];
  /** Goal target value (e.g. 76). */
  targetValue: number;
  /** Goal deadline YYYY-MM-DD; X-axis end (end of that local day). */
  targetDate?: string;
  unit?: string;
};

type Pt = { key: string; value: number; hour: number };

/** Hours since epoch, truncated to local hour. */
function parseHour(iso: string): number | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setMinutes(0, 0, 0);
  return d.getTime() / 3600000;
}

function parseDayEndHour(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 0, 0, 0);
  return Number.isFinite(d.getTime()) ? d.getTime() / 3600000 : null;
}

function nowHour(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d.getTime() / 3600000;
}

function formatHourLabel(hour: number): string {
  const d = new Date(hour * 3600000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:00`;
}

function formatDayLabel(hour: number): string {
  const d = new Date(hour * 3600000);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function dayKeyFromHour(hour: number): string | null {
  const d = new Date(hour * 3600000);
  if (!Number.isFinite(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 目标打卡折线：
 * - 起点 = 首次打卡实测值
 * - 目标 = 任务 targetValue
 * - X 轴 = 首次打卡小时 → 截止日（无截止则取现在与末次打卡较晚者）
 * - 同日可有多条记录，图表只取**当天最晚**一条
 */
export default function CheckinChart({
  checkins,
  targetValue,
  targetDate,
  unit,
}: Props) {
  const unitSuffix = unit?.trim() ? unit.trim() : "";

  // Chart: one point per calendar day = that day's latest (latest hour) check-in.
  const chronological: Pt[] = [];
  const byDay = new Map<string, Pt>();
  for (const c of checkins) {
    const hour = parseHour(c.createdAt) ?? parseHour(`${c.date}T12:00:00`);
    const value = Number(c.value);
    if (hour == null || !Number.isFinite(value)) continue;
    const pt = { key: c.id, value, hour };
    chronological.push(pt);
    const dayKey = dayKeyFromHour(hour) ?? c.date.slice(0, 10);
    const prev = byDay.get(dayKey);
    if (!prev || hour >= prev.hour) {
      byDay.set(dayKey, pt);
    }
  }
  chronological.sort((a, b) => a.hour - b.hour);
  const points: Pt[] = [...byDay.values()].sort((a, b) => a.hour - b.hour);

  if (!Number.isFinite(targetValue)) {
    return (
      <div className="checkin-chart">
        <p className="muted hint">任务缺少有效目标值，无法绘图。</p>
      </div>
    );
  }

  if (points.length === 0 || chronological.length === 0) {
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
          {unitSuffix}，首次 82.8 → 起点 82.8）。同日可多次；图表按每天最晚一次登记。
        </p>
      </div>
    );
  }

  // 起点 = 全局首次打卡；折线点 = 每天最晚一次；当前 = 折线末点
  const startValue = chronological[0].value;
  const current = points[points.length - 1].value;
  const prev = points.length > 1 ? points[points.length - 2].value : null;
  const x0 = chronological[0].hour;
  const deadlineHour = targetDate ? parseDayEndHour(targetDate) : null;
  const x1 = Math.max(
    points[points.length - 1].hour,
    deadlineHour ?? -Infinity,
    nowHour(),
  );
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

  const xAt = (hour: number) => pad.l + ((hour - x0) / (xEnd - x0)) * innerW;
  const yAt = (v: number) => pad.t + innerH - ((v - minV) / span) * innerH;

  // Few Y labels only — never one tick per data point (overlaps / unreadable).
  const yTicks = spacedYTicks(
    [maxV, minV, targetValue, startValue, (minV + maxV) / 2],
    yAt,
    18,
  );

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(p.hour).toFixed(1)} ${yAt(p.value).toFixed(1)}`,
    )
    .join(" ");

  const axisY0 = pad.t + innerH;
  const axisX0 = pad.l;
  const closerGood = closerLabel?.includes("更近");
  const xLabels = buildXLabels(x0, xEnd, deadlineHour);

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
            key={p.key}
            cx={xAt(p.hour)}
            cy={yAt(p.value)}
            r={3.4}
            className="checkin-chart__dot"
          />
        ))}

        {deadlineHour != null && deadlineHour >= x0 && deadlineHour <= xEnd ? (
          <line
            x1={xAt(deadlineHour)}
            x2={xAt(deadlineHour)}
            y1={pad.t}
            y2={axisY0}
            className="checkin-chart__deadline"
          />
        ) : null}

        {xLabels.map((lab) => (
          <text
            key={`x-${lab.hour}-${lab.text}`}
            x={xAt(lab.hour)}
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
        {deadlineHour != null ? (
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
  deadlineHour: number | null,
): { hour: number; text: string; emphasis?: boolean }[] {
  const span = xEnd - x0;
  const useHourLabels = span <= 72; // ≤3 days → show hour
  const label = (h: number) => (useHourLabels ? formatHourLabel(h) : formatDayLabel(h));
  const out: { hour: number; text: string; emphasis?: boolean }[] = [
    { hour: x0, text: label(x0) },
  ];
  if (span > 24) {
    out.push({ hour: x0 + span / 2, text: label(x0 + span / 2) });
  }
  out.push({ hour: xEnd, text: label(xEnd) });
  if (deadlineHour != null && deadlineHour > x0 + 1 && deadlineHour < xEnd - 1) {
    out.push({
      hour: deadlineHour,
      text: `截止 ${formatDayLabel(deadlineHour)}`,
      emphasis: true,
    });
  }
  out.sort((a, b) => a.hour - b.hour);
  const deduped: typeof out = [];
  for (const lab of out) {
    if (deduped.every((x) => Math.abs(x.hour - lab.hour) > span * 0.08 || span < 6)) {
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

function spacedYTicks(
  candidates: number[],
  yAt: (v: number) => number,
  minGapPx: number,
): number[] {
  // Keep input order as priority (first wins when labels would overlap).
  const uniq: number[] = [];
  for (const v of candidates) {
    if (!Number.isFinite(v)) continue;
    if (uniq.every((x) => Math.abs(x - v) > 1e-6)) uniq.push(v);
  }
  const out: number[] = [];
  for (const v of uniq) {
    if (out.every((x) => Math.abs(yAt(x) - yAt(v)) >= minGapPx)) out.push(v);
  }
  return out.sort((a, b) => b - a);
}

function formatNum(n: number) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (Number.isInteger(n)) return String(n);
  if (a >= 100) return (Math.round(n * 10) / 10).toString();
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, "") || "0";
}

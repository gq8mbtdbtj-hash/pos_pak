import { useMemo, useState } from "react";
import type { CategorySum, TxHighlight } from "../services/api";

const COLORS = [
  "#c45c3e",
  "#0f6b5c",
  "#d9a07a",
  "#3d7ea6",
  "#8b5e3c",
  "#5c6b4a",
  "#a63d5c",
  "#4a6fa5",
  "#6b5b95",
  "#7a8b6e",
];

interface Props {
  data: CategorySum[];
  size?: "md" | "lg";
}

interface Tip {
  x: number;
  y: number;
  category: string;
  amount: number;
  pct: number;
  items: TxHighlight[];
}

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function polar(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export default function CategoryPie({ data, size = "md" }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const dim = size === "lg" ? 300 : 220;
  const cx = dim / 2;
  const cy = dim / 2;
  const outerR = size === "lg" ? 128 : 92;
  const innerR = size === "lg" ? 62 : 48;

  const slices = useMemo(() => {
    if (total <= 0) return [];
    let angle = -Math.PI / 2;
    return data.map((d, i) => {
      const sweep = (d.amount / total) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      return {
        ...d,
        start,
        end,
        color: COLORS[i % COLORS.length],
        pct: (d.amount / total) * 100,
      };
    });
  }, [data, total]);

  if (total <= 0) {
    return <p className="empty-state compact">暂无支出分类</p>;
  }

  const moveTip = (e: React.MouseEvent, s: (typeof slices)[0]) => {
    const parent = (e.currentTarget as Element).closest(".pie-wrap");
    const rect = parent?.getBoundingClientRect();
    const localX = e.clientX - (rect?.left ?? 0);
    const tipW = 280;
    setTip({
      x: Math.min(localX + 12, (rect?.width ?? tipW) - tipW - 8),
      y: Math.max(8, e.clientY - (rect?.top ?? 0) - 8),
      category: s.category,
      amount: s.amount,
      pct: s.pct,
      items: s.top ?? [],
    });
  };

  return (
    <div
      className={`pie-wrap${size === "lg" ? " pie-wrap--lg" : ""}`}
      onMouseLeave={() => setTip(null)}
    >
      <svg
        viewBox={`0 0 ${dim} ${dim}`}
        className="pie-svg"
        role="img"
        aria-label="支出分类饼图"
      >
        {slices.map((s) => (
          <path
            key={s.category}
            d={arcPath(cx, cy, outerR, s.start, s.end)}
            fill={s.color}
            className="pie-slice"
            onMouseEnter={(e) => moveTip(e, s)}
            onMouseMove={(e) => moveTip(e, s)}
          />
        ))}
        <circle cx={cx} cy={cy} r={innerR} fill="var(--panel-solid)" />
        <text x={cx} y={cy - 6} textAnchor="middle" className="pie-center-label">
          支出
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="pie-center-value">
          ¥{money(total)}
        </text>
      </svg>

      <ul className="pie-legend">
        {slices.map((s) => (
          <li key={s.category}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="name">{s.category}</span>
            <span className="pct">{s.pct.toFixed(0)}%</span>
            <strong>¥{money(s.amount)}</strong>
          </li>
        ))}
      </ul>

      {tip && (
        <div className="chart-tooltip chart-tooltip--rich" style={{ left: tip.x, top: tip.y }}>
          <div className="chart-tooltip-head">
            <strong>{tip.category}</strong>
            <span className="amount-expense">
              ¥{money(tip.amount)} · {tip.pct.toFixed(1)}%
            </span>
          </div>
          {tip.items.length === 0 ? (
            <p className="muted">暂无明细</p>
          ) : (
            <ul>
              {tip.items.map((item) => (
                <li key={item.id}>
                  <span className="tip-label">
                    {item.label}
                    {item.occurredAt && (
                      <small>
                        {" "}
                        {new Date(item.occurredAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    )}
                  </span>
                  <span>¥{money(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

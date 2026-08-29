import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartBucket, TxHighlight } from "../services/api";

interface Props {
  data: ChartBucket[];
  height?: number;
}

interface TooltipState {
  x: number;
  y: number;
  label: string;
  income: number;
  expense: number;
  topIncome: TxHighlight[];
  topExpense: TxHighlight[];
}

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export default function FinanceChart({ data, height = 260 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hostW, setHostW] = useState(720);
  const [tip, setTip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setHostW(Math.max(320, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { max, pathIncome, pathExpense, bars, w } = useMemo(() => {
    const maxVal = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
    const padL = 44;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const minByPoints = Math.max(480, data.length * 36);
    const width = Math.max(hostW, minByPoints);
    const innerW = width - padL - padR;
    const innerH = height - padT - padB;
    const n = Math.max(data.length, 1);
    const gap = data.length > 20 ? 2 : data.length > 10 ? 4 : 8;
    const groupW = innerW / n;
    const barW = Math.max(4, Math.min(22, (groupW - gap) / 2));

    const bars = data.map((d, i) => {
      const cx = padL + groupW * i + groupW / 2;
      const incomeH = (d.income / maxVal) * innerH;
      const expenseH = (d.expense / maxVal) * innerH;
      return {
        ...d,
        hitX: padL + groupW * i,
        hitW: groupW,
        incomeX: cx - barW - 1,
        expenseX: cx + 1,
        incomeY: padT + innerH - incomeH,
        expenseY: padT + innerH - expenseH,
        incomeH,
        expenseH,
        barW,
        labelX: cx,
      };
    });

    const linePoints = (key: "income" | "expense") =>
      data
        .map((d, i) => {
          const x = padL + groupW * i + groupW / 2;
          const y = padT + innerH - (d[key] / maxVal) * innerH;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");

    return {
      max: maxVal,
      pathIncome: linePoints("income"),
      pathExpense: linePoints("expense"),
      bars,
      w: width,
    };
  }, [data, height, hostW]);

  const showEvery = data.length > 16 ? 3 : data.length > 10 ? 2 : 1;

  const showTip = (event: React.MouseEvent<SVGRectElement>, bucket: ChartBucket) => {
    const parent = event.currentTarget.closest(".finance-chart");
    const parentRect = parent?.getBoundingClientRect();
    const localX = event.clientX - (parentRect?.left ?? 0);
    const localY = event.clientY - (parentRect?.top ?? 0);
    const tipW = 280;
    const x = Math.min(localX + 14, (parentRect?.width ?? tipW) - tipW - 8);
    const y = Math.max(8, localY - 12);
    setTip({
      x,
      y,
      label: bucket.label,
      income: bucket.income,
      expense: bucket.expense,
      topIncome: bucket.topIncome ?? [],
      topExpense: bucket.topExpense ?? [],
    });
  };

  return (
    <div className="finance-chart" ref={wrapRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label="收支趋势图">
        <defs>
          <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--income)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--income)" stopOpacity="0.55" />
          </linearGradient>
          <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--expense)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--expense)" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((t) => {
          const y = 16 + (height - 48) * (1 - t);
          return (
            <g key={t}>
              <line x1="44" x2={w - 16} y1={y} y2={y} className="chart-grid" />
              <text x="4" y={y + 4} className="chart-axis">
                {Math.round(max * t)}
              </text>
            </g>
          );
        })}

        <path d={pathIncome} className="chart-line income" fill="none" />
        <path d={pathExpense} className="chart-line expense" fill="none" />

        {bars.map((b) => (
          <g key={b.label + b.incomeX}>
            <rect
              x={b.hitX}
              y={16}
              width={b.hitW}
              height={height - 48}
              fill="transparent"
              onMouseEnter={(e) => showTip(e, b)}
              onMouseMove={(e) => showTip(e, b)}
            />
            <rect
              x={b.incomeX}
              y={b.incomeY}
              width={b.barW}
              height={Math.max(b.incomeH, b.income > 0 ? 2 : 0)}
              rx="2"
              fill="url(#incomeFill)"
              className="chart-bar"
              pointerEvents="none"
            />
            <rect
              x={b.expenseX}
              y={b.expenseY}
              width={b.barW}
              height={Math.max(b.expenseH, b.expense > 0 ? 2 : 0)}
              rx="2"
              fill="url(#expenseFill)"
              className="chart-bar"
              pointerEvents="none"
            />
          </g>
        ))}

        {bars.map((b, i) =>
          i % showEvery === 0 ? (
            <text
              key={`l-${b.label}`}
              x={b.labelX}
              y={height - 10}
              textAnchor="middle"
              className="chart-axis"
            >
              {b.label}
            </text>
          ) : null,
        )}
      </svg>

      {tip && (tip.income > 0 || tip.expense > 0) && (
        <div className="chart-tooltip chart-tooltip--rich" style={{ left: tip.x, top: tip.y }}>
          <div className="chart-tooltip-head">
            <strong>{tip.label}</strong>
          </div>
          <div className="chart-tooltip-totals">
            <span className="amount-income">收入 ¥{money(tip.income)}</span>
            <span className="amount-expense">支出 ¥{money(tip.expense)}</span>
          </div>
          {tip.topExpense.length > 0 && (
            <div className="chart-tooltip-section">
              <p className="chart-tooltip-section-title">支出明细</p>
              <ul>
                {tip.topExpense.map((item) => (
                  <li key={`e-${item.id}`}>
                    <span className="tip-label">
                      <em>{item.category}</em>
                      {item.label && item.label !== item.category ? ` · ${item.label}` : ""}
                    </span>
                    <span>¥{money(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tip.topIncome.length > 0 && (
            <div className="chart-tooltip-section">
              <p className="chart-tooltip-section-title">收入明细</p>
              <ul>
                {tip.topIncome.map((item) => (
                  <li key={`i-${item.id}`}>
                    <span className="tip-label">
                      <em>{item.category}</em>
                      {item.label && item.label !== item.category ? ` · ${item.label}` : ""}
                    </span>
                    <span>¥{money(item.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tip.topExpense.length === 0 && tip.topIncome.length === 0 && (
            <p className="muted">该时段暂无明细</p>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import CategoryPie from "../components/CategoryPie";
import FinanceChart from "../components/FinanceChart";
import InputDock from "../components/InputDock";
import PageShell from "../components/PageShell";
import Select from "../components/Select";
import { api, ChartBucket, FinanceSummary, Transaction } from "../services/api";

type Range = "day" | "week" | "month";

const RANGE_LABEL: Record<Range, string> = {
  day: "今日",
  week: "本周",
  month: "本月",
};

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function rangeBounds(range: Range): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (range === "day") {
    return { start: startOfDay(now), end };
  }
  if (range === "week") {
    const start = startOfDay(now);
    const day = (start.getDay() + 6) % 7; // Monday=0
    start.setDate(start.getDate() - day);
    return { start, end };
  }
  const start = startOfDay(now);
  start.setDate(1);
  return { start, end };
}

function inRange(iso: string, range: Range) {
  const t = new Date(iso).getTime();
  const { start, end } = rangeBounds(range);
  return t >= start.getTime() && t <= end.getTime();
}

function flow(summary: FinanceSummary, range: Range) {
  if (range === "day") return summary.today;
  if (range === "week") return summary.week;
  return summary.month;
}

function categoriesFor(summary: FinanceSummary, range: Range) {
  if (range === "day") return summary.categoryDay;
  if (range === "week") return summary.categoryWeek;
  return summary.categoryMonth;
}

function trimChart(data: ChartBucket[]): ChartBucket[] {
  if (data.length <= 7) return data;
  let first = 0;
  let last = data.length - 1;
  while (first < data.length && data[first].income === 0 && data[first].expense === 0) {
    first += 1;
  }
  while (last > first && data[last].income === 0 && data[last].expense === 0) {
    last -= 1;
  }
  first = Math.max(0, first - 1);
  return data.slice(first, last + 1);
}

function dateLabel(iso: string) {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const diff = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export default function FinancePage({
  onNavigate,
}: {
  onNavigate: (page: "debts") => void;
}) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [quick, setQuick] = useState("");
  const [message, setMessage] = useState("");
  const [range, setRange] = useState<Range>("month");
  const [chartView, setChartView] = useState<"trend" | "category">("trend");

  const load = useCallback(async () => {
    const [sum, cats, txs] = await Promise.all([
      api.financeSummary(),
      api.financeCategories(),
      api.financeList(500),
    ]);
    setSummary(sum);
    setCategories(cats);
    setTransactions(txs);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onPrefs = () => {
      void load();
    };
    window.addEventListener("personal-os:prefs-changed", onPrefs);
    return () => window.removeEventListener("personal-os:prefs-changed", onPrefs);
  }, [load]);

  const quickCapture = async () => {
    if (!quick.trim()) return;
    const text = quick.trim();
    const parsed = await api.quickCaptureParse(text);
    if (parsed.kind === "finance" && parsed.transaction) {
      await api.financeQuickAdd(text);
      setMessage("已记账");
    } else if (parsed.kind === "task" && parsed.task) {
      await api.taskCreate({ title: parsed.task.title });
      setMessage("已创建任务");
    } else if (parsed.quickNote) {
      await api.quickNoteCreate({ content: parsed.quickNote.content, noteType: "capture" });
      setMessage("已记录");
    } else {
      setMessage("未能识别");
    }
    setQuick("");
    load();
    setTimeout(() => setMessage(""), 2200);
  };

  const changeCategory = async (id: string, category: string) => {
    const next = category.trim();
    if (!next) return;
    const current = transactions.find((t) => t.id === id);
    if (current && current.category === next) return;
    await api.financeUpdate(id, { category: next });
    load();
  };

  const changeType = async (id: string, transactionType: Transaction["transactionType"]) => {
    await api.financeUpdate(id, { transactionType });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除此记录？")) return;
    await api.financeDelete(id);
    load();
  };

  const filtered = useMemo(
    () => transactions.filter((t) => inRange(t.occurredAt, range)),
    [transactions, range],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const key = startOfDay(new Date(t.occurredAt)).toISOString();
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const listIncome = filtered
    .filter((t) => t.transactionType === "income")
    .reduce((s, t) => s + t.amount, 0);
  const listExpense = filtered
    .filter((t) => t.transactionType === "expense")
    .reduce((s, t) => s + t.amount, 0);

  const chartData = useMemo(() => {
    if (!summary) return [];
    const raw =
      range === "day"
        ? summary.chartDay
        : range === "week"
          ? summary.chartWeek
          : summary.chartMonth;
    return trimChart(raw);
  }, [summary, range]);

  const current = summary ? flow(summary, range) : null;
  const pieData = summary ? categoriesFor(summary, range) : [];
  const net = summary
    ? summary.payPeriod.income - summary.payPeriod.expense
    : 0;
  const monthNet = summary ? summary.month.income - summary.month.expense : 0;

  return (
    <PageShell
      className="page-finance"
      eyebrow="Cashflow"
      title="记账"
      stack
      actions={
        <div className="segmented" role="group" aria-label="时间范围与外债">
          {(["day", "week", "month"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              className={range === r ? "active" : ""}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
          <span className="segmented-divider" aria-hidden />
          <button type="button" onClick={() => onNavigate("debts")}>
            外债
          </button>
        </div>
      }
      dock={
        <InputDock label="快速记账" message={message || undefined}>
          <input
            placeholder="例如：电信欠费 88 / 冰箱卖了36 / 午饭 35"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickCapture()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={quickCapture}>
            记录
          </button>
        </InputDock>
      }
    >
      {summary && (
        <section className="panel">
          <div className="fiscal-banner">
            <div>
              <span className="muted">当月总体盈亏</span>
              <strong className={monthNet >= 0 ? "amount-income" : "amount-expense"}>
                {monthNet >= 0 ? "+" : ""}¥{money(monthNet)}
              </strong>
            </div>
            <div className="fiscal-banner-sub">
              <span>收入 ¥{money(summary.month.income)}</span>
              <span>支出 ¥{money(summary.month.expense)}</span>
            </div>
          </div>
        </section>
      )}

      {summary && current && (
        <section className="panel">
          <div className="flow-strip finance-flow">
            <div className="flow-stat">
              <span>收入 · {RANGE_LABEL[range]}</span>
              <strong className="amount-income">¥{money(current.income)}</strong>
            </div>
            <div className="flow-stat">
              <span>支出 · {RANGE_LABEL[range]}</span>
              <strong className="amount-expense">¥{money(current.expense)}</strong>
            </div>
            <div className="flow-stat">
              <span>结余 · {summary.payPeriodLabel || "发薪周期"}</span>
              <strong className={net >= 0 ? "amount-income" : "amount-expense"}>
                {net >= 0 ? "+" : ""}¥{money(net)}
              </strong>
            </div>
            <div className="flow-stat">
              <span>外债剩余</span>
              <strong className="amount-expense">¥{money(summary.debtRemaining ?? 0)}</strong>
            </div>
          </div>

          {(summary.debtRepaymentMonth > 0 || summary.debtMonthlyObligation > 0) && (
            <div className="finance-debt-link">
              <div>
                <span className="muted">本月外债还款</span>
                <strong>¥{money(summary.debtRepaymentMonth ?? 0)}</strong>
              </div>
              <div>
                <span className="muted">计划月供</span>
                <strong>¥{money(summary.debtMonthlyObligation ?? 0)}</strong>
              </div>
              <p className="muted">外债还款会记入「外债还款」分类，与记账数据联动。</p>
            </div>
          )}

          <div className="chart-solo">
            <div className="chart-block chart-block--solo">
              <div className="chart-block-title">
                <div className="segmented chart-view-toggle" role="tablist" aria-label="图表类型">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chartView === "trend"}
                    className={chartView === "trend" ? "active" : ""}
                    onClick={() => setChartView("trend")}
                  >
                    时间趋势
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chartView === "category"}
                    className={chartView === "category" ? "active" : ""}
                    onClick={() => setChartView("category")}
                  >
                    分类构成
                  </button>
                </div>
                <span className="muted chart-block-meta">
                  {chartView === "trend" ? (
                    <>
                      <span className="dot income" /> 收入
                      <span className="dot expense" /> 支出
                    </>
                  ) : (
                    <>{pieData.length} 类</>
                  )}
                </span>
              </div>
              {chartView === "trend" ? (
                <FinanceChart data={chartData} height={320} />
              ) : (
                <CategoryPie data={pieData} size="lg" />
              )}
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="tx-list-head">
          <h3 className="section-label">
            {RANGE_LABEL[range]}记录
            <span className="muted"> · {filtered.length} 笔</span>
          </h3>
          <p className="muted tx-list-sum">
            入 ¥{money(listIncome)} · 出 ¥{money(listExpense)}
            {Math.abs(listExpense - (current?.expense ?? 0)) > 0.5 && (
              <span className="tx-mismatch"> · 与汇总差需刷新</span>
            )}
          </p>
        </div>

        {filtered.length === 0 ? (
          <p className="empty-state compact">该时间范围内暂无记录</p>
        ) : (
          <div className="tx-groups">
            {grouped.map(([dayKey, items]) => (
              <div key={dayKey} className="tx-group">
                <div className="tx-group-label">
                  <strong>{dateLabel(items[0].occurredAt)}</strong>
                  <span className="muted">
                    {items.length} 笔 · 出 ¥
                    {money(
                      items
                        .filter((t) => t.transactionType === "expense")
                        .reduce((s, t) => s + t.amount, 0),
                    )}
                  </span>
                </div>
                {items.map((t) => {
                  const title = t.merchant || t.note || t.category || "未命名";
                  const sub = [t.note && t.merchant ? t.note : null, t.category]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div key={t.id} className="tx-card">
                      <div className="tx-card-main">
                        <div className="tx-card-title-row">
                          <strong className="tx-card-title">{title}</strong>
                          <span
                            className={
                              t.transactionType === "income" ? "amount-income" : "amount-expense"
                            }
                          >
                            {t.transactionType === "income" ? "+" : "-"}¥{money(t.amount)}
                          </span>
                        </div>
                        <div className="tx-card-sub muted">
                          <span>{timeLabel(t.occurredAt)}</span>
                          {sub && <span> · {sub}</span>}
                          {t.tags?.includes("外债") && <span className="tx-tag">外债</span>}
                        </div>
                        <div className="tx-card-controls">
                          <label className="field compact">
                            <span>类型</span>
                            <Select
                              size="sm"
                              ariaLabel="类型"
                              value={t.transactionType}
                              options={[
                                { value: "expense", label: "支出" },
                                { value: "income", label: "收入" },
                              ]}
                              onChange={(v) =>
                                changeType(t.id, v as Transaction["transactionType"])
                              }
                            />
                          </label>
                          <label className="field compact">
                            <span>分类</span>
                            <Select
                              size="sm"
                              ariaLabel="分类"
                              value={t.category}
                              options={[
                                ...new Set(
                                  [t.category, ...categories].filter(Boolean),
                                ),
                              ].map((c) => ({ value: c, label: c }))}
                              onChange={(v) => changeCategory(t.id, v)}
                              placeholder="分类"
                            />
                          </label>
                          <button
                            className="btn btn-ghost danger"
                            type="button"
                            onClick={() => remove(t.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}

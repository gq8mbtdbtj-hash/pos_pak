import { useCallback, useEffect, useMemo, useState } from "react";
import CategoryPie from "../components/CategoryPie";
import FinanceChart from "../components/FinanceChart";
import {
  api,
  ChartBucket,
  DashboardStats,
  FinanceSummary,
  HabitWithStats,
  Task,
} from "../services/api";

type PageId =
  | "dashboard"
  | "tasks"
  | "habits"
  | "finance"
  | "debts"
  | "knowledge"
  | "search"
  | "settings";

interface Props {
  onNavigate: (page: PageId) => void;
}

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
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

export default function Dashboard({ onNavigate }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<HabitWithStats[]>([]);
  const [capture, setCapture] = useState("");
  const [message, setMessage] = useState("");
  const [chartView, setChartView] = useState<"trend" | "category">("trend");

  const load = useCallback(async () => {
    const [s, sum, t, h] = await Promise.all([
      api.getDashboard(),
      api.financeSummary(),
      api.taskListToday(),
      api.habitList(),
    ]);
    setStats(s);
    setSummary(sum);
    setTasks(t);
    setHabits(h);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCapture = async () => {
    if (!capture.trim()) return;
    const parsed = await api.quickCaptureParse(capture);
    if (parsed.kind === "finance" && parsed.transaction) {
      await api.financeQuickAdd(capture);
      setMessage("已记账");
    } else if (parsed.kind === "task" && parsed.task) {
      await api.taskCreate({ title: parsed.task.title });
      setMessage("已创建任务");
    } else if (parsed.quickNote) {
      await api.quickNoteCreate({ content: parsed.quickNote.content, noteType: "capture" });
      setMessage("已记录");
    }
    setCapture("");
    load();
    setTimeout(() => setMessage(""), 2000);
  };

  const toggleTask = async (task: Task) => {
    if (task.status === "done") return;
    await api.taskComplete(task.id);
    load();
  };

  const toggleHabit = async (habit: HabitWithStats) => {
    const id = habit.habit?.id;
    if (!id) return;
    if (habit.checkedToday) {
      await api.habitUncheck(id);
    } else {
      await api.habitCheckIn(id);
    }
    load();
  };

  const chartData = useMemo(
    () => (summary ? trimChart(summary.chartMonth) : []),
    [summary],
  );
  const pieData = summary?.categoryMonth ?? [];

  return (
    <div className="page page-dashboard">
      <header className="page-header">
        <div>
          <p className="eyebrow">Today</p>
          <h2 className="page-title">今天</h2>
        </div>
      </header>

      {stats && (
        <section className="panel">
          <div className="fiscal-banner">
            <div>
              <span className="muted">当月总体盈亏</span>
              <strong className={stats.monthNet >= 0 ? "amount-income" : "amount-expense"}>
                {stats.monthNet >= 0 ? "+" : ""}¥{money(stats.monthNet)}
              </strong>
            </div>
            <div className="fiscal-banner-sub">
              <span>收入 ¥{money(stats.monthIncome)}</span>
              <span>支出 ¥{money(stats.monthExpense)}</span>
              <button type="button" className="linkish" onClick={() => onNavigate("finance")}>
                记账详情
              </button>
            </div>
          </div>
          <div className="flow-strip finance-flow dash-flow">
            <div className="flow-stat">
              <span>任务</span>
              <strong>
                {stats.tasksDone} / {stats.tasksTotal}
              </strong>
            </div>
            <div className="flow-stat">
              <span>习惯</span>
              <strong>
                {stats.habitsDone} / {stats.habitsTotal}
              </strong>
            </div>
            <div className="flow-stat">
              <span>今日消费</span>
              <strong className="amount-expense">¥{money(stats.todaySpending)}</strong>
            </div>
            <div className="flow-stat">
              <span>外债剩余</span>
              <strong className="amount-expense">¥{money(stats.debtRemaining ?? 0)}</strong>
            </div>
          </div>
          {(stats.debtMonthlyObligation > 0 || stats.monthsToPayoff) && (
            <p className="muted dash-debt-hint">
              计划月供 ¥{money(stats.debtMonthlyObligation ?? 0)}
              {stats.monthsToPayoff != null ? ` · 预计还 ${stats.monthsToPayoff} 期` : ""}
              {stats.payoffDate ? ` · 至 ${stats.payoffDate}` : ""}
              {" · "}
              <button type="button" className="linkish" onClick={() => onNavigate("debts")}>
                查看外债
              </button>
            </p>
          )}
        </section>
      )}

      {summary && (
        <section className="panel">
          <div className="chart-solo">
            <div className="chart-block chart-block--solo chart-block--dash">
              <div className="chart-block-title">
                <div className="segmented chart-view-toggle" role="tablist" aria-label="图表类型">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chartView === "trend"}
                    className={chartView === "trend" ? "active" : ""}
                    onClick={() => setChartView("trend")}
                  >
                    本月趋势
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
                <button type="button" className="linkish" onClick={() => onNavigate("finance")}>
                  打开记账
                </button>
              </div>
              {chartView === "trend" ? (
                <FinanceChart data={chartData} height={280} />
              ) : (
                <CategoryPie data={pieData} size="lg" />
              )}
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <h3 className="section-label">快速记录</h3>
        <div className="quick-capture">
          <input
            placeholder="输入今天发生了什么…… 例如：冰箱卖了36 / 咖啡28地铁4 / 明天9点开会"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCapture()}
          />
          <button className="btn" onClick={handleCapture}>
            记录
          </button>
        </div>
        {message && <p className="muted hint">{message}</p>}
      </section>

      <div className="dash-grid-2">
        <section className="panel">
          <div className="tx-list-head">
            <h3 className="section-label">今日任务</h3>
            <button type="button" className="linkish" onClick={() => onNavigate("tasks")}>
              管理
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="empty-state compact">暂无任务</p>
          ) : (
            tasks.map((t) => (
              <div key={t.id} className="list-item">
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={() => toggleTask(t)}
                />
                <span style={{ textDecoration: t.status === "done" ? "line-through" : "none" }}>
                  {t.title}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <div className="tx-list-head">
            <h3 className="section-label">今日习惯</h3>
            <button type="button" className="linkish" onClick={() => onNavigate("habits")}>
              管理
            </button>
          </div>
          {habits.length === 0 ? (
            <p className="empty-state compact">暂无习惯</p>
          ) : (
            habits.map((h) => (
              <div key={h.habit?.id ?? String(h.streak)} className="list-item">
                <input
                  type="checkbox"
                  checked={!!h.checkedToday}
                  onChange={() => toggleHabit(h)}
                  disabled={!h.habit?.id}
                />
                <span>{h.habit?.name ?? "未命名习惯"}</span>
                <span className="muted">连续 {h.streak ?? 0} 天</span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

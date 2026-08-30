import { useCallback, useEffect, useMemo, useState } from "react";
import CategoryPie from "../components/CategoryPie";
import DueRiskStrip from "../components/DueRiskStrip";
import FinanceChart from "../components/FinanceChart";
import InputDock from "../components/InputDock";
import PageShell from "../components/PageShell";
import { SELECT_GOAL_KEY, openPaySnapshotEditor } from "../lib/glance";
import { isMobile } from "../lib/platform";
import {
  api,
  ChartBucket,
  DashboardStats,
  FinanceSummary,
  Goal,
  Task,
} from "../services/api";

type PageId =
  | "dashboard"
  | "tasks"
  | "habits"
  | "finance"
  | "debts"
  | "knowledge"
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
  const mobile = isMobile();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [checkins, setCheckins] = useState<Goal[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [capture, setCapture] = useState("");
  const [message, setMessage] = useState("");
  const [chartView, setChartView] = useState<"trend" | "category">("trend");

  const load = useCallback(async () => {
    const [s, sum, allTasks, t, g] = await Promise.all([
      api.getDashboard(),
      api.financeSummary(),
      api.taskList(),
      api.taskListToday(),
      api.goalList(),
    ]);
    setStats(s);
    setSummary(sum);
    setTasks(allTasks);
    setTodayTasks(t);
    const active = g.filter((x) => x.status === "active");
    setCheckins(
      active.filter((x) => x.kind === "checkin" || x.kind === "habit").slice(0, 8),
    );
    setGoals(active.filter((x) => x.kind === "plan" || x.kind === "normal" || !x.kind).slice(0, 4));
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

  const tapHabit = async (g: Goal) => {
    if (g.kind === "habit") {
      if (g.checkedToday) return;
      await api.goalAddCheckin(g.id, { value: 1 });
      load();
      return;
    }
    try {
      sessionStorage.setItem(SELECT_GOAL_KEY, g.id);
    } catch {
      /* ignore */
    }
    onNavigate("habits");
  };

  const chartData = useMemo(
    () => (summary ? trimChart(summary.chartMonth) : []),
    [summary],
  );
  const pieData = summary?.categoryMonth ?? [];

  const glance = summary?.payPeriodGlance;
  const periodFlow = summary
    ? summary.payPeriod.income - summary.payPeriod.expense
    : stats
      ? (stats.payPeriodIncome ?? 0) - (stats.payPeriodExpense ?? 0)
      : 0;
  const payNet = glance?.effective ?? stats?.payPeriodEffective ?? periodFlow;
  const openingMissing =
    glance?.openingMissing ?? stats?.payPeriodOpeningMissing ?? true;
  const opening = glance?.opening ?? stats?.payPeriodOpening ?? null;
  const afterDebts = glance?.afterDebts ?? stats?.payPeriodAfterDebts;
  const dueThisPeriod = glance?.dueThisPeriod ?? stats?.payPeriodDueThisPeriod ?? 0;
  const payLabel = summary?.payPeriodLabel || stats?.payPeriodLabel || "发薪周期";
  const lastSnap = summary?.snapshots?.[0];
  const pending = summary?.pendingSnapshot;
  const atRisk = checkins.filter((g) => g.kind === "habit" && g.streakAtRisk).length;
  const habitLine = stats
    ? `今日 ${stats.habitsDone} / ${stats.habitsTotal}${atRisk > 0 ? " · 连续有风险" : ""}`
    : "";

  return (
    <PageShell
      className="page-dashboard"
      eyebrow="Today"
      title="今天"
      dock={
        <InputDock label="快速记录" message={message || undefined}>
          <input
            placeholder="快速记录… 例：咖啡28 / 明天9点开会"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCapture()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={handleCapture}>
            记录
          </button>
        </InputDock>
      }
    >
        {stats && (
          <section className="panel">
            <div className="fiscal-banner">
              <div>
                <span className="muted">有效结余 · {payLabel}</span>
                <strong className={payNet >= 0 ? "amount-income" : "amount-expense"}>
                  {payNet >= 0 ? "+" : ""}¥{money(payNet)}
                </strong>
              </div>
              <div className="fiscal-banner-sub">
                <span>收入 ¥{money(summary?.payPeriod.income ?? stats.payPeriodIncome ?? 0)}</span>
                <span>支出 ¥{money(summary?.payPeriod.expense ?? stats.payPeriodExpense ?? 0)}</span>
                <button type="button" className="linkish" onClick={() => onNavigate("finance")}>
                  记账详情
                </button>
              </div>
            </div>
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              {openingMissing
                ? `未确认上期 · 仅账单净额 ${periodFlow >= 0 ? "+" : ""}¥${money(periodFlow)}`
                : `含上期结余 ${opening != null && opening >= 0 ? "+" : ""}¥${money(opening ?? 0)} · 账单净额 ${periodFlow >= 0 ? "+" : ""}¥${money(periodFlow)}`}
              {afterDebts != null
                ? ` · 还债后 ${afterDebts >= 0 ? "+" : ""}¥${money(afterDebts)}${dueThisPeriod > 0 ? `（应还 ¥${money(dueThisPeriod)}）` : ""}`
                : ""}
            </p>
            {pending ? (
              <button
                type="button"
                className="pending-banner amount-expense"
                onClick={() => openPaySnapshotEditor()}
              >
                上期结余待确认 · {pending.periodLabel} · {pending.net >= 0 ? "+" : ""}¥
                {money(pending.net)} · 点此修正
              </button>
            ) : lastSnap ? (
              <button
                type="button"
                className="pending-banner muted"
                onClick={() => openPaySnapshotEditor(lastSnap.id)}
              >
                上期已存档 · {lastSnap.periodLabel} · {lastSnap.net >= 0 ? "+" : ""}¥
                {money(lastSnap.net)} · 点此修正
              </button>
            ) : null}
            <p className="muted" style={{ margin: "0.35rem 0 0" }}>
              日历月盈亏 {stats.monthNet >= 0 ? "+" : ""}¥{money(stats.monthNet)}
            </p>
            <div className="flow-strip finance-flow dash-flow">
              <div className="flow-stat">
                <span>任务</span>
                <strong>
                  {stats.tasksDone} / {stats.tasksTotal}
                </strong>
              </div>
              <div className="flow-stat">
                <span>打卡</span>
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
            <DueRiskStrip tasks={tasks} onOpen={() => onNavigate("tasks")} />
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

        {summary && !mobile && (
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

        <div className="dash-grid-2">
          <section className="panel">
            <div className="tx-list-head">
              <h3 className="section-label">今日任务</h3>
              <button type="button" className="linkish" onClick={() => onNavigate("tasks")}>
                管理
              </button>
            </div>
            {todayTasks.length === 0 ? (
              <p className="empty-state compact">暂无任务</p>
            ) : (
              todayTasks.map((t) => (
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
              <h3 className="section-label">今日养成</h3>
              <button type="button" className="linkish" onClick={() => onNavigate("habits")}>
                管理
              </button>
            </div>
            {habitLine && <p className="muted hint">{habitLine}</p>}
            {checkins.length === 0 ? (
              <p className="empty-state compact">暂无习惯或打卡</p>
            ) : (
              checkins.map((g) => (
                <div key={g.id} className="list-item dash-habit-row">
                  {g.kind === "habit" ? (
                    <input
                      className="dash-habit-check"
                      type="checkbox"
                      checked={!!g.checkedToday}
                      onChange={() => void tapHabit(g)}
                      aria-label={`打卡 ${g.title}`}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="list-item--btn"
                    style={{ flex: 1, border: "none", background: "transparent", textAlign: "left" }}
                    onClick={() => void tapHabit(g)}
                  >
                    <span>
                      <span className="goal-kind-badge">
                        {g.kind === "habit" ? "习惯" : "打卡"}
                      </span>
                      {g.title}
                    </span>
                    <span className="muted">
                      {g.kind === "habit" && g.streak != null
                        ? `连续 ${g.streak}/66${g.gap != null && g.gap > 0 ? ` · 还差 ${g.gap} 天` : ""}`
                        : `${g.progress}%`}
                      {g.kind === "checkin" ? " · 填实测" : ""}
                    </span>
                  </button>
                </div>
              ))
            )}
            {goals.length > 0 && (
              <div className="dash-goals">
                <h4 className="section-label">进行中计划</h4>
                {goals.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="goal-card"
                    onClick={() => {
                      try {
                        sessionStorage.setItem(SELECT_GOAL_KEY, g.id);
                      } catch {
                        /* ignore */
                      }
                      onNavigate("habits");
                    }}
                  >
                    <div className="goal-card-top">
                      <strong>{g.title}</strong>
                      <span className="muted">{g.progress}%</span>
                    </div>
                    <div className="goal-progress">
                      <div className="goal-progress-fill" style={{ width: `${g.progress}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
    </PageShell>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, Goal, GoalDetail } from "../services/api";
import InputDock from "../components/InputDock";
import DockDateField from "../components/DockDateField";
import PageShell from "../components/PageShell";
import CheckinChart from "../components/CheckinChart";
import { toastErr } from "../components/Toast";
import { SELECT_GOAL_KEY } from "../lib/glance";
import { isMobile } from "../lib/platform";

type GoalDock = "goal" | "log";
type GoalKind = "plan" | "habit" | "checkin";
type GoalFilter = "all" | GoalKind;

function statusLabel(status: Goal["status"]) {
  if (status === "done") return "已完成";
  if (status === "paused") return "暂停";
  return "进行中";
}

function normalizeKind(kind: Goal["kind"] | undefined): GoalKind {
  if (kind === "checkin") return "checkin";
  if (kind === "habit") return "habit";
  return "plan";
}

function kindLabel(kind: Goal["kind"] | undefined) {
  const k = normalizeKind(kind);
  if (k === "checkin") return "打卡";
  if (k === "habit") return "习惯";
  return "计划";
}

function usesDaily(kind: Goal["kind"] | undefined) {
  const k = normalizeKind(kind);
  return k === "habit" || k === "checkin";
}

/** `datetime-local` value truncated to the hour. */
function defaultLogAtHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

function formatCheckinWhen(createdAt: string, date: string): string {
  const d = new Date(createdAt);
  if (!Number.isFinite(d.getTime())) return date;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:00`;
}

/** One row per calendar day — keep the latest check-in that day. */
function latestCheckinPerDay(checkins: GoalDetail["checkins"]) {
  const byDay = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    const day = (c.date || "").slice(0, 10) || formatCheckinWhen(c.createdAt, "").slice(0, 10);
    const prev = byDay.get(day);
    if (
      !prev ||
      new Date(c.createdAt).getTime() >= new Date(prev.createdAt).getTime()
    ) {
      byDay.set(day, c);
    }
  }
  return [...byDay.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function HabitHeatmap({ dates }: { dates: string[] }) {
  const set = new Set(dates.map((d) => d.slice(0, 10)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cells = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push(
      <div
        key={key}
        className={`habit-heat-cell${set.has(key) ? " habit-heat-cell--on" : ""}`}
        title={key}
      />,
    );
  }
  return <div className="habit-heat" aria-label="近 12 周出勤">{cells}</div>;
}

export default function HabitsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<GoalDetail | null>(null);
  const [goalDock, setGoalDock] = useState<GoalDock>("goal");
  const [goalFilter, setGoalFilter] = useState<GoalFilter>("habit");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalKind, setGoalKind] = useState<GoalKind>("habit");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [logNote, setLogNote] = useState("");
  const [logValue, setLogValue] = useState("");
  const [logAt, setLogAt] = useState(defaultLogAtHour);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [showCheckinChart, setShowCheckinChart] = useState(() => !isMobile());

  const refreshGoals = useCallback(async (preferId?: string | null) => {
    const list = await api.goalList();
    setGoals(list);

    const wantId = preferId ?? null;
    if (wantId) {
      const still = list.find((g) => g.id === wantId);
      if (still) {
        setSelectedGoal(await api.goalDetail(still.id));
        setGoalDock("log");
        return;
      }
    }

    setSelectedGoal((prev) => {
      if (prev && list.some((g) => g.id === prev.goal.id)) {
        void api.goalDetail(prev.goal.id).then(setSelectedGoal);
        return prev;
      }
      return null;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      let prefer: string | null = null;
      try {
        prefer = sessionStorage.getItem(SELECT_GOAL_KEY);
        if (prefer) sessionStorage.removeItem(SELECT_GOAL_KEY);
      } catch {
        /* ignore */
      }
      if (prefer) {
        const list = await api.goalList();
        const g = list.find((x) => x.id === prefer);
        if (g) setGoalFilter(normalizeKind(g.kind));
      }
      await refreshGoals(prefer);
    } catch (e) {
      toastErr(String(e));
    }
  }, [refreshGoals]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedGoal) {
      setGoalDock("log");
      return;
    }
    setGoalDock("goal");
  }, [selectedGoal]);

  // Tab switch: never keep a detail that doesn't belong to the active filter.
  useEffect(() => {
    setLogNote("");
    setLogValue("");
    setMilestoneTitle("");
    setMilestoneDue("");
    if (goalFilter === "habit" || goalFilter === "checkin" || goalFilter === "plan") {
      setGoalKind(goalFilter);
    }
    setSelectedGoal((prev) => {
      if (!prev) return null;
      if (goalFilter === "all") return prev;
      return normalizeKind(prev.goal.kind) === goalFilter ? prev : null;
    });
  }, [goalFilter]);

  const filteredGoals = useMemo(() => {
    const rank = (kind: Goal["kind"] | undefined) => {
      const k = normalizeKind(kind);
      if (k === "habit") return 0;
      if (k === "checkin") return 1;
      return 2;
    };
    const list =
      goalFilter === "all"
        ? goals
        : goals.filter((g) => normalizeKind(g.kind) === goalFilter);
    return [...list].sort((a, b) => rank(a.kind) - rank(b.kind));
  }, [goals, goalFilter]);

  const createGoal = async () => {
    if (!goalTitle.trim()) return;
    try {
      if (goalKind === "checkin") {
        const target = Number(targetValue);
        if (!Number.isFinite(target)) {
          toastErr("请填写目标值（例如 76）");
          return;
        }
        const g = await api.goalCreate({
          title: goalTitle.trim(),
          targetDate: goalDate || undefined,
          kind: "checkin",
          targetValue: target,
          unit: unit.trim() || undefined,
        });
        setGoalTitle("");
        setGoalDate("");
        setTargetValue("");
        setUnit("");
        setGoalFilter("checkin");
        await refreshGoals(g.id);
        return;
      }
      if (goalKind === "habit") {
        const g = await api.goalCreate({
          title: goalTitle.trim(),
          kind: "habit",
        });
        setGoalTitle("");
        setGoalFilter("habit");
        await refreshGoals(g.id);
        return;
      }
      const g = await api.goalCreate({
        title: goalTitle.trim(),
        targetDate: goalDate || undefined,
        kind: "plan",
      });
      setGoalTitle("");
      setGoalDate("");
      setGoalFilter("plan");
      await refreshGoals(g.id);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const openGoal = async (id: string) => {
    try {
      setSelectedGoal(await api.goalDetail(id));
      setGoalDock("log");
    } catch (e) {
      toastErr(String(e));
    }
  };

  const startNewGoal = () => {
    setSelectedGoal(null);
    setGoalDock("goal");
  };

  const addMilestone = async () => {
    if (!selectedGoal || !milestoneTitle.trim()) return;
    if (normalizeKind(selectedGoal.goal.kind) !== "plan") return;
    if (!milestoneDue.trim()) {
      toastErr("请填写里程碑截止日");
      return;
    }
    try {
      const detail = await api.goalAddMilestone(selectedGoal.goal.id, {
        title: milestoneTitle.trim(),
        dueDate: milestoneDue.trim(),
      });
      setMilestoneTitle("");
      setMilestoneDue("");
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const toggleMilestone = async (id: string, done: boolean) => {
    try {
      const detail = await api.goalSetMilestoneDone(id, done);
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const addCheckin = async () => {
    if (!selectedGoal) return;
    const kind = normalizeKind(selectedGoal.goal.kind);
    if (!usesDaily(kind)) return;
    if (kind === "checkin") {
      const valueNum = Number(logValue.trim());
      if (!Number.isFinite(valueNum)) {
        toastErr("请填写实测值");
        return;
      }
      const at = (logAt || defaultLogAtHour()).slice(0, 16);
      try {
        const detail = await api.goalAddCheckin(selectedGoal.goal.id, {
          note: logNote.trim() || undefined,
          value: valueNum,
          at,
          date: at.slice(0, 10),
        });
        setLogNote("");
        setLogValue("");
        setLogAt(defaultLogAtHour());
        setSelectedGoal(detail);
        setGoals(await api.goalList());
      } catch (e) {
        toastErr(String(e));
      }
      return;
    }
    // habit: presence only
    try {
      const detail = await api.goalAddCheckin(selectedGoal.goal.id, {
        note: logNote.trim() || undefined,
        value: 1,
      });
      setLogNote("");
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const removeMilestone = async (id: string) => {
    if (!confirm("确定删除此里程碑？")) return;
    try {
      const detail = await api.goalDeleteMilestone(id);
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const removeCheckin = async (id: string) => {
    if (!confirm("确定删除这条打卡记录？")) return;
    try {
      const detail = await api.goalDeleteCheckin(id);
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const removeGoal = async (id: string) => {
    if (!confirm("确定删除此项及其记录？")) return;
    try {
      await api.goalDelete(id);
      setSelectedGoal(null);
      setGoalDock("goal");
      await refreshGoals();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const selectedKind = selectedGoal ? normalizeKind(selectedGoal.goal.kind) : "plan";
  const logLabel =
    selectedKind === "checkin"
      ? "打卡"
      : selectedKind === "habit"
        ? "今日习惯"
        : "新建里程碑";
  const doneCount = selectedGoal?.milestones.filter((m) => m.done).length ?? 0;
  const stageCount = selectedGoal?.milestones.length ?? 0;
  const checkinCount = selectedGoal?.checkins.length ?? 0;
  const checkinDays = selectedGoal
    ? latestCheckinPerDay(selectedGoal.checkins)
    : [];
  const checkinDayCount = checkinDays.length;

  const chartTarget = Number(selectedGoal?.goal.targetValue);
  const chartReady =
    selectedKind === "checkin" && Number.isFinite(chartTarget);
  const habitStreak = selectedGoal?.goal.streak ?? 0;

  return (
    <PageShell
      className="page-habits-goals"
      eyebrow="Growth"
      title="养成"
      stack
      actions={
        <div
          className="segmented segmented--grow"
          role="tablist"
          aria-label="分类筛选"
        >
          {(
            [
              ["habit", "习惯"],
              ["checkin", "打卡"],
              ["plan", "计划"],
              ["all", "全部"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={goalFilter === id ? "active" : ""}
              aria-selected={goalFilter === id}
              onClick={() => setGoalFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      }
      dock={
        <InputDock
          label={goalDock === "log" ? logLabel : "新建"}
          variant="composer"
        >
          {goals.length > 0 && (
            <div className="segmented dock-segmented" role="tablist" aria-label="录入模式">
              <button
                type="button"
                role="tab"
                className={goalDock === "goal" ? "active" : ""}
                aria-selected={goalDock === "goal"}
                onClick={startNewGoal}
                data-no-tab-swipe
              >
                新建
              </button>
              <button
                type="button"
                role="tab"
                className={goalDock === "log" ? "active" : ""}
                aria-selected={goalDock === "log"}
                disabled={!selectedGoal}
                onClick={() => selectedGoal && setGoalDock("log")}
                data-no-tab-swipe
              >
                {selectedGoal
                  ? selectedKind === "plan"
                    ? "里程碑"
                    : "打卡"
                  : "记录"}
              </button>
            </div>
          )}
          {goalDock === "log" && selectedGoal ? (
            selectedKind === "checkin" ? (
              <>
                <input
                  className="dock-composer-title"
                  placeholder={`为「${selectedGoal.goal.title}」填写备注（可选）`}
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCheckin()}
                  data-no-tab-swipe
                />
                <div className="dock-composer-actions">
                  <input
                    className="dock-milestone-progress"
                    type="datetime-local"
                    step={3600}
                    value={logAt}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        setLogAt(defaultLogAtHour());
                        return;
                      }
                      // Force minutes to :00
                      setLogAt(`${v.slice(0, 13)}:00`);
                    }}
                    aria-label="打卡时间（精确到小时）"
                    data-no-tab-swipe
                  />
                  <input
                    className="dock-milestone-progress"
                    type="number"
                    inputMode="decimal"
                    placeholder={`实测值${selectedGoal.goal.unit ? `（${selectedGoal.goal.unit}）` : ""}`}
                    value={logValue}
                    onChange={(e) => setLogValue(e.target.value)}
                    data-no-tab-swipe
                  />
                  <button className="btn" type="button" onClick={addCheckin}>
                    打卡
                  </button>
                </div>
              </>
            ) : selectedKind === "habit" ? (
              <>
                <input
                  className="dock-composer-title"
                  placeholder={
                    selectedGoal.checkedToday
                      ? `「${selectedGoal.goal.title}」今日已打卡，可改备注`
                      : `为「${selectedGoal.goal.title}」打卡（备注可选）`
                  }
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCheckin()}
                  data-no-tab-swipe
                />
                <div className="dock-composer-actions">
                  <button className="btn" type="button" onClick={addCheckin}>
                    {selectedGoal.checkedToday ? "更新" : "打卡"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  className="dock-composer-title"
                  placeholder={`为「${selectedGoal.goal.title}」添加里程碑`}
                  value={milestoneTitle}
                  onChange={(e) => setMilestoneTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMilestone()}
                  data-no-tab-swipe
                />
                <div className="dock-composer-actions">
                  <DockDateField
                    label="截止"
                    value={milestoneDue}
                    onChange={setMilestoneDue}
                    ariaLabel="里程碑截止日"
                  />
                  <button className="btn" type="button" onClick={addMilestone}>
                    添加
                  </button>
                </div>
              </>
            )
          ) : (
            <>
              <div className="segmented dock-segmented" role="tablist" aria-label="类型">
                {(
                  [
                    ["habit", "习惯"],
                    ["checkin", "打卡"],
                    ["plan", "计划"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={goalKind === id ? "active" : ""}
                    aria-selected={goalKind === id}
                    onClick={() => setGoalKind(id)}
                    data-no-tab-swipe
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className="dock-composer-title"
                placeholder={
                  goalKind === "checkin"
                    ? "例如：减重到 76kg"
                    : goalKind === "habit"
                      ? "例如：每天阅读 30 分钟"
                      : "例如：完成产品改版"
                }
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createGoal()}
                data-no-tab-swipe
              />
              {goalKind === "checkin" ? (
                <div className="dock-composer-actions dock-composer-actions--wrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="目标值"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    data-no-tab-swipe
                  />
                  <input
                    placeholder="单位"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    data-no-tab-swipe
                    style={{ maxWidth: "4.5rem" }}
                  />
                  <DockDateField
                    label="截止日"
                    value={goalDate}
                    onChange={setGoalDate}
                    ariaLabel="打卡目标截止日期"
                  />
                  <button className="btn" type="button" onClick={createGoal}>
                    添加
                  </button>
                </div>
              ) : goalKind === "habit" ? (
                <div className="dock-composer-actions">
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    66 天养成 · 漏 1 天可续
                  </span>
                  <button className="btn" type="button" onClick={createGoal}>
                    添加
                  </button>
                </div>
              ) : (
                <div className="dock-composer-actions">
                  <DockDateField
                    label="截止日"
                    value={goalDate}
                    onChange={setGoalDate}
                    ariaLabel="计划截止日期"
                  />
                  <button className="btn" type="button" onClick={createGoal}>
                    添加
                  </button>
                </div>
              )}
            </>
          )}
        </InputDock>
      }
    >
      <p className="muted hint" style={{ marginBottom: "0.75rem" }}>
        计划：里程碑勾选（必填截止日）；习惯：66 天出勤养成；打卡：起止实测值 + 折线差距。
      </p>
      <div className="goal-layout">
        <section className="panel">
          <div className="goal-panel-head">
            <h3 className="section-label">列表 · {filteredGoals.length}</h3>
            <button type="button" className="btn btn-ghost" onClick={startNewGoal}>
              新建
            </button>
          </div>
          {filteredGoals.length === 0 ? (
            <p className="empty-state compact">还没有内容，用底部新建</p>
          ) : (
            filteredGoals.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`goal-card ${selectedGoal?.goal.id === g.id ? "active" : ""}`}
                onClick={() => openGoal(g.id)}
              >
                <div className="goal-card-top">
                  <strong>
                    <span className="goal-kind-badge">{kindLabel(g.kind)}</span>
                    {g.title}
                    {g.formed ? <span className="habit-formed-badge">已养成</span> : null}
                  </strong>
                  <span className="muted">{g.progress}%</span>
                </div>
                <div className="goal-progress">
                  <div className="goal-progress-fill" style={{ width: `${g.progress}%` }} />
                </div>
                <div className="muted">
                  {statusLabel(g.status)}
                  {normalizeKind(g.kind) === "habit" && g.streak != null
                    ? ` · 连续 ${g.streak}/66`
                    : ""}
                  {normalizeKind(g.kind) === "checkin" && g.gap != null
                    ? ` · ${
                        g.gap > 0.0001
                          ? `还差 ${Number(g.gap).toFixed(Number.isInteger(g.gap) ? 0 : 1)}`
                          : g.gap < -0.0001
                            ? `超出 ${Number(Math.abs(g.gap)).toFixed(Number.isInteger(g.gap) ? 0 : 1)}`
                            : "已达目标"
                      }`
                    : ""}
                  {g.targetDate ? ` · 至 ${g.targetDate}` : ""}
                </div>
              </button>
            ))
          )}
        </section>

        <section className="panel">
          {!selectedGoal ? (
            <p className="empty-state">
              {goals.length === 0
                ? "还没有内容，请先用底部栏新建"
                : "选择一项查看详情"}
            </p>
          ) : (
            <>
              <div className="debt-detail-head">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>
                    <span className="goal-kind-badge">
                      {kindLabel(selectedGoal.goal.kind)}
                    </span>
                    {selectedGoal.goal.title}
                  </h3>
                  <p className="muted">
                    进度 {selectedGoal.goal.progress}%
                    {selectedKind === "habit"
                      ? ` · 连续 ${habitStreak}/66${
                          selectedGoal.checkedToday ? " · 今日已打卡" : ""
                        }`
                      : selectedKind === "checkin"
                        ? ` · ${checkinDayCount} 天${
                            checkinCount > checkinDayCount
                              ? `（共 ${checkinCount} 次）`
                              : ""
                          }${selectedGoal.checkedToday ? " · 今日已打卡" : ""}`
                        : stageCount > 0
                          ? ` · 里程碑 ${doneCount}/${stageCount}`
                          : ""}
                    {selectedGoal.goal.targetDate
                      ? ` · 截止 ${selectedGoal.goal.targetDate}`
                      : ""}
                  </p>
                </div>
                <button
                  className="btn btn-ghost danger"
                  onClick={() => removeGoal(selectedGoal.goal.id)}
                >
                  删除
                </button>
              </div>

              {selectedKind === "checkin" ? (
                <>
                  {isMobile() && chartReady && (
                    <button
                      type="button"
                      className="btn btn-ghost workbench-toggle"
                      onClick={() => setShowCheckinChart((v) => !v)}
                    >
                      {showCheckinChart ? "收起折线" : "查看打卡折线"}
                    </button>
                  )}
                  {chartReady ? (
                    (!isMobile() || showCheckinChart) ? (
                    <CheckinChart
                      checkins={selectedGoal.checkins}
                      targetValue={chartTarget}
                      targetDate={selectedGoal.goal.targetDate}
                      unit={selectedGoal.goal.unit}
                    />
                    ) : null
                  ) : (
                    <p className="empty-state compact">
                      缺少目标值，请重建该打卡任务（目标如 76 + 单位 kg）
                    </p>
                  )}
                  {checkinDays.length === 0 ? (
                    <p className="empty-state compact">
                      暂无记录；可同日多次打卡，列表与图表按每天最晚一次显示
                    </p>
                  ) : (
                    checkinDays.map((c) => (
                      <div key={c.id} className="list-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div>{c.note || "打卡"}</div>
                          <div className="muted">
                            {formatCheckinWhen(c.createdAt, c.date)} · 值 {c.value}
                            {selectedGoal.goal.unit ?? ""}
                          </div>
                        </div>
                        <button
                          className="btn btn-ghost danger"
                          type="button"
                          onClick={() => removeCheckin(c.id)}
                        >
                          删除
                        </button>
                      </div>
                    ))
                  )}
                </>
              ) : selectedKind === "habit" ? (
                <>
                  <div className="habit-66-track" aria-hidden style={{ marginBottom: "0.75rem" }}>
                    <div
                      className="habit-66-fill"
                      style={{
                        width: `${Math.min(100, (habitStreak / 66) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="muted hint" style={{ marginBottom: "0.75rem" }}>
                    漏 1 天可延续；连续 2 天未打卡则中断。
                  </p>
                  {!isMobile() && selectedGoal.checkins.length > 0 && (
                    <HabitHeatmap dates={selectedGoal.checkins.map((c) => c.date)} />
                  )}
                  {selectedGoal.checkins.length === 0 ? (
                    <p className="empty-state compact">暂无打卡，用底部一键打卡</p>
                  ) : (
                    selectedGoal.checkins.map((c) => (
                      <div key={c.id} className="list-item">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div>{c.note || "已打卡"}</div>
                          <div className="muted">{c.date}</div>
                        </div>
                        <button
                          className="btn btn-ghost danger"
                          type="button"
                          onClick={() => removeCheckin(c.id)}
                        >
                          删除
                        </button>
                      </div>
                    ))
                  )}
                </>
              ) : selectedGoal.milestones.length === 0 ? (
                <p className="empty-state compact">
                  暂无里程碑，用底部填写标题与截止日后添加
                </p>
              ) : (
                selectedGoal.milestones.map((m) => (
                  <div key={m.id} className="list-item">
                    <input
                      type="checkbox"
                      checked={m.done}
                      onChange={() => toggleMilestone(m.id, !m.done)}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          textDecoration: m.done ? "line-through" : "none",
                        }}
                      >
                        {m.title}
                      </div>
                      <div className="muted">
                        {m.dueDate ? `截止 ${m.dueDate}` : "未设截止日"}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost danger"
                      type="button"
                      onClick={() => removeMilestone(m.id)}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}

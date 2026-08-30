import { useCallback, useEffect, useState } from "react";
import { api, Goal, GoalDetail, HabitWithStats } from "../services/api";
import InputDock from "../components/InputDock";
import { toastErr } from "../components/Toast";

type Segment = "habits" | "goals";
type GoalDock = "goal" | "milestone";

function habitId(h: HabitWithStats) {
  return h.habit?.id;
}

function habitName(h: HabitWithStats) {
  return h.habit?.name ?? "未命名习惯";
}

function statusLabel(status: Goal["status"]) {
  if (status === "done") return "已完成";
  if (status === "paused") return "暂停";
  return "进行中";
}

export default function HabitsPage() {
  const [segment, setSegment] = useState<Segment>("habits");
  const [habits, setHabits] = useState<HabitWithStats[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<GoalDetail | null>(null);
  const [goalDock, setGoalDock] = useState<GoalDock>("goal");
  const [name, setName] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");

  const loadHabits = useCallback(async () => {
    setHabits(await api.habitList());
  }, []);

  const refreshGoals = useCallback(async (preferId?: string | null) => {
    const list = await api.goalList();
    setGoals(list);

    const wantId = preferId ?? null;
    if (wantId) {
      const still = list.find((g) => g.id === wantId);
      if (still) {
        setSelectedGoal(await api.goalDetail(still.id));
        setGoalDock("milestone");
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
      await Promise.all([loadHabits(), refreshGoals()]);
    } catch (e) {
      toastErr(String(e));
    }
  }, [loadHabits, refreshGoals]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (segment !== "goals") return;
    if (selectedGoal) {
      setGoalDock("milestone");
      return;
    }
    setGoalDock("goal");
  }, [segment, selectedGoal]);

  const createHabit = async () => {
    if (!name.trim()) return;
    try {
      await api.habitCreate({ name });
      setName("");
      await loadHabits();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const toggleHabit = async (h: HabitWithStats) => {
    const id = habitId(h);
    if (!id) return;
    try {
      if (h.checkedToday) await api.habitUncheck(id);
      else await api.habitCheckIn(id);
      await loadHabits();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const removeHabit = async (id: string | undefined) => {
    if (!id || !confirm("确定删除此习惯？")) return;
    try {
      await api.habitDelete(id);
      await loadHabits();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const createGoal = async () => {
    if (!goalTitle.trim()) return;
    try {
      const g = await api.goalCreate({
        title: goalTitle.trim(),
        targetDate: goalDate || undefined,
      });
      setGoalTitle("");
      setGoalDate("");
      await refreshGoals(g.id);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const openGoal = async (id: string) => {
    try {
      setSelectedGoal(await api.goalDetail(id));
      setGoalDock("milestone");
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
    try {
      const detail = await api.goalAddMilestone(selectedGoal.goal.id, {
        title: milestoneTitle.trim(),
        dueDate: milestoneDue || undefined,
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

  const removeMilestone = async (id: string) => {
    if (!confirm("确定删除里程碑？")) return;
    try {
      const detail = await api.goalDeleteMilestone(id);
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const removeGoal = async (id: string) => {
    if (!confirm("确定删除此目标及其里程碑？")) return;
    try {
      await api.goalDelete(id);
      setSelectedGoal(null);
      setGoalDock("goal");
      await refreshGoals();
    } catch (e) {
      toastErr(String(e));
    }
  };

  const doneCount = selectedGoal
    ? selectedGoal.milestones.filter((m) => m.done).length
    : 0;
  const totalCount = selectedGoal?.milestones.length ?? 0;

  return (
    <div className="page page-habits-goals page--with-dock">
      <div className="page-scroll">
        <header className="page-header page-header--stack">
          <div>
            <p className="eyebrow">Growth</p>
            <h2 className="page-title">习惯与目标</h2>
          </div>
          <div className="segmented segmented--grow" role="tablist" aria-label="切换内容区">
            <button
              type="button"
              role="tab"
              className={segment === "habits" ? "active" : ""}
              aria-selected={segment === "habits"}
              onClick={() => setSegment("habits")}
            >
              习惯
            </button>
            <button
              type="button"
              role="tab"
              className={segment === "goals" ? "active" : ""}
              aria-selected={segment === "goals"}
              onClick={() => setSegment("goals")}
            >
              目标
            </button>
          </div>
        </header>

        {segment === "habits" ? (
          <section className="panel">
            {habits.length === 0 ? (
              <p className="empty-state">暂无习惯</p>
            ) : (
              habits.map((h) => {
                const id = habitId(h);
                return (
                  <div key={id ?? habitName(h)} className="list-item">
                    <input
                      type="checkbox"
                      checked={!!h.checkedToday}
                      onChange={() => toggleHabit(h)}
                      disabled={!id}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div>{habitName(h)}</div>
                      <div className="muted">
                        连续 {h.streak ?? 0} 天 · 完成率{" "}
                        {Number(h.completionRate ?? 0).toFixed(0)}%
                      </div>
                    </div>
                    <button className="btn btn-danger" onClick={() => removeHabit(id)} disabled={!id}>
                      删除
                    </button>
                  </div>
                );
              })
            )}
          </section>
        ) : (
          <>
            <p className="muted hint" style={{ marginBottom: "0.75rem" }}>
              选择左侧目标查看里程碑；用底部「新目标、里程碑」切换录入。
            </p>
            <div className="goal-layout">
              <section className="panel">
                <div className="goal-panel-head">
                  <h3 className="section-label">目标列表 · {goals.length}</h3>
                  <button type="button" className="btn btn-ghost" onClick={startNewGoal}>
                    新建目标
                  </button>
                </div>
                {goals.length === 0 ? (
                  <p className="empty-state compact">还没有目标，点「新建目标」或用底部新建</p>
                ) : (
                  goals.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`goal-card ${selectedGoal?.goal.id === g.id ? "active" : ""}`}
                      onClick={() => openGoal(g.id)}
                    >
                      <div className="goal-card-top">
                        <strong>{g.title}</strong>
                        <span className="muted">{g.progress}%</span>
                      </div>
                      <div className="goal-progress">
                        <div className="goal-progress-fill" style={{ width: `${g.progress}%` }} />
                      </div>
                      <div className="muted">
                        {statusLabel(g.status)}
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
                      ? "还没有目标，请先用底部栏新建"
                      : "在左侧选择一个目标查看详情"}
                  </p>
                ) : (
                  <>
                    <div className="debt-detail-head">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3>{selectedGoal.goal.title}</h3>
                        <p className="muted">
                          进度 {selectedGoal.goal.progress}%
                          {totalCount > 0 ? ` · 里程碑 ${doneCount}/${totalCount}` : ""}
                          {selectedGoal.goal.targetDate
                            ? ` · 目标日 ${selectedGoal.goal.targetDate}`
                            : ""}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost danger"
                        onClick={() => removeGoal(selectedGoal.goal.id)}
                      >
                        删除目标
                      </button>
                    </div>
                    {selectedGoal.milestones.length === 0 ? (
                      <p className="empty-state compact">
                        暂无里程碑，用底部「里程碑」模式添加
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
                            {m.dueDate && <div className="muted">截止 {m.dueDate}</div>}
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
          </>
        )}
      </div>

      {segment === "habits" ? (
        <InputDock label="新建习惯">
          <input
            placeholder="例如：每天阅读 30 分钟"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createHabit()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={createHabit}>
            添加
          </button>
        </InputDock>
      ) : (
        <InputDock
          label={goalDock === "milestone" ? "添加里程碑" : "新建目标"}
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
                新目标
              </button>
              <button
                type="button"
                role="tab"
                className={goalDock === "milestone" ? "active" : ""}
                aria-selected={goalDock === "milestone"}
                disabled={!selectedGoal}
                onClick={() => selectedGoal && setGoalDock("milestone")}
                data-no-tab-swipe
              >
                里程碑
              </button>
            </div>
          )}
          {goalDock === "milestone" && selectedGoal ? (
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
                <label className="dock-date-field">
                  <span>截止</span>
                  <input
                    type="date"
                    value={milestoneDue}
                    onChange={(e) => setMilestoneDue(e.target.value)}
                    aria-label="里程碑截止日期"
                    data-no-tab-swipe
                  />
                </label>
                <button className="btn" type="button" onClick={addMilestone}>
                  添加
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                className="dock-composer-title"
                placeholder="例如：今年读完 10 本"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createGoal()}
                data-no-tab-swipe
              />
              <div className="dock-composer-actions">
                <label className="dock-date-field">
                  <span>目标日</span>
                  <input
                    type="date"
                    value={goalDate}
                    onChange={(e) => setGoalDate(e.target.value)}
                    aria-label="目标日期"
                    data-no-tab-swipe
                  />
                </label>
                <button className="btn" type="button" onClick={createGoal}>
                  添加
                </button>
              </div>
            </>
          )}
        </InputDock>
      )}
    </div>
  );
}

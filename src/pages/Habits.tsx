import { useCallback, useEffect, useState } from "react";
import { api, Goal, GoalDetail, HabitWithStats } from "../services/api";
import InputDock from "../components/InputDock";
import { toastErr } from "../components/Toast";

type Segment = "habits" | "goals";

function habitId(h: HabitWithStats) {
  return h.habit?.id;
}

function habitName(h: HabitWithStats) {
  return h.habit?.name ?? "未命名习惯";
}

export default function HabitsPage() {
  const [segment, setSegment] = useState<Segment>("habits");
  const [habits, setHabits] = useState<HabitWithStats[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<GoalDetail | null>(null);
  const [name, setName] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");

  const loadHabits = useCallback(async () => {
    setHabits(await api.habitList());
  }, []);

  const loadGoals = useCallback(async () => {
    const list = await api.goalList();
    setGoals(list);
    if (selectedGoal) {
      const still = list.find((g) => g.id === selectedGoal.goal.id);
      if (still) {
        setSelectedGoal(await api.goalDetail(still.id));
      } else {
        setSelectedGoal(null);
      }
    }
  }, [selectedGoal]);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadHabits(), loadGoals()]);
    } catch (e) {
      toastErr(String(e));
    }
  }, [loadHabits, loadGoals]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

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
      await loadGoals();
      setSelectedGoal(await api.goalDetail(g.id));
    } catch (e) {
      toastErr(String(e));
    }
  };

  const openGoal = async (id: string) => {
    setSelectedGoal(await api.goalDetail(id));
  };

  const addMilestone = async () => {
    if (!selectedGoal || !milestoneTitle.trim()) return;
    try {
      const detail = await api.goalAddMilestone(selectedGoal.goal.id, {
        title: milestoneTitle.trim(),
      });
      setMilestoneTitle("");
      setSelectedGoal(detail);
      setGoals(await api.goalList());
    } catch (e) {
      toastErr(String(e));
    }
  };

  const toggleMilestone = async (id: string, done: boolean) => {
    const detail = await api.goalSetMilestoneDone(id, done);
    setSelectedGoal(detail);
    setGoals(await api.goalList());
  };

  const removeGoal = async (id: string) => {
    if (!confirm("确定删除该目标及里程碑？")) return;
    await api.goalDelete(id);
    setSelectedGoal(null);
    await loadGoals();
  };

  return (
    <div className="page page-habits-goals page--with-dock">
      <div className="page-scroll">
        <header className="page-header page-header--stack">
          <div>
            <p className="eyebrow">Growth</p>
            <h2 className="page-title">习惯与目标</h2>
          </div>
          <div className="segmented segmented--grow" role="tablist" aria-label="习惯与目标">
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
              目标是结果；习惯与任务是过程。可在目标下拆里程碑追赶进度。
            </p>
            <div className="goal-layout">
              <section className="panel">
                <h3 className="section-label">目标列表</h3>
                {goals.length === 0 ? (
                  <p className="empty-state compact">暂无目标</p>
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
                        {g.status === "active" ? "进行中" : g.status === "done" ? "已完成" : "搁置"}
                        {g.targetDate ? ` · 至 ${g.targetDate}` : ""}
                      </div>
                    </button>
                  ))
                )}
              </section>

              <section className="panel">
                {!selectedGoal ? (
                  <p className="empty-state">选择目标查看里程碑</p>
                ) : (
                  <>
                    <div className="debt-detail-head">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3>{selectedGoal.goal.title}</h3>
                        <p className="muted">
                          进度 {selectedGoal.goal.progress}%
                          {selectedGoal.goal.targetDate
                            ? ` · 目标日 ${selectedGoal.goal.targetDate}`
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
                    {selectedGoal.milestones.length === 0 ? (
                      <p className="empty-state compact">
                        暂无里程碑，添加后进度将按完成比例汇总
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
        <InputDock label="添加习惯">
          <input
            placeholder="新习惯，例如：每天阅读 30 分钟"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createHabit()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={createHabit}>
            添加
          </button>
        </InputDock>
      ) : selectedGoal ? (
        <InputDock label="添加里程碑">
          <input
            placeholder="新里程碑"
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMilestone()}
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={addMilestone}>
            添加
          </button>
        </InputDock>
      ) : (
        <InputDock label="添加目标">
          <input
            placeholder="新目标，例如：年储蓄 10 万"
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createGoal()}
            data-no-tab-swipe
          />
          <input
            type="date"
            value={goalDate}
            onChange={(e) => setGoalDate(e.target.value)}
            aria-label="目标日期"
            data-no-tab-swipe
          />
          <button className="btn" type="button" onClick={createGoal}>
            添加
          </button>
        </InputDock>
      )}
    </div>
  );
}

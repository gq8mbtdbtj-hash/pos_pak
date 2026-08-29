import { useCallback, useEffect, useState } from "react";
import { api, HabitWithStats } from "../services/api";

function habitId(h: HabitWithStats) {
  return h.habit?.id;
}

function habitName(h: HabitWithStats) {
  return h.habit?.name ?? "未命名习惯";
}

export default function HabitsPage() {
  const [habits, setHabits] = useState<HabitWithStats[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setHabits(await api.habitList());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    try {
      await api.habitCreate({ name });
      setName("");
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggle = async (h: HabitWithStats) => {
    const id = habitId(h);
    if (!id) return;
    try {
      if (h.checkedToday) {
        await api.habitUncheck(id);
      } else {
        await api.habitCheckIn(id);
      }
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (id: string | undefined) => {
    if (!id) return;
    if (!confirm("确定删除此习惯？")) return;
    try {
      await api.habitDelete(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Habits</p>
          <h2 className="page-title">习惯</h2>
        </div>
      </header>
      {error && <p className="settings-banner settings-banner--err">{error}</p>}
      <div className="card">
        <div className="form-row">
          <input
            placeholder="新习惯，例如：每天阅读 30 分钟"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={create}>
            添加
          </button>
        </div>
      </div>
      <div className="card">
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
                  onChange={() => toggle(h)}
                  disabled={!id}
                />
                <div style={{ flex: 1 }}>
                  <div>{habitName(h)}</div>
                  <div className="muted">
                    连续 {h.streak ?? 0} 天 · 完成率{" "}
                    {Number(h.completionRate ?? 0).toFixed(0)}%
                  </div>
                </div>
                <button className="btn btn-danger" onClick={() => remove(id)} disabled={!id}>
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

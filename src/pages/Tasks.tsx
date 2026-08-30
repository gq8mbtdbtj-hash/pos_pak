import { useCallback, useEffect, useMemo, useState } from "react";
import { daysLeftLabel, daysUntilDue } from "../components/DebtReminderPopups";
import InputDock from "../components/InputDock";
import PageShell from "../components/PageShell";
import Select from "../components/Select";
import { api, Task } from "../services/api";

type Priority = "high" | "medium" | "low";

const PRIORITY_ORDER: Priority[] = ["high", "medium", "low"];
const PRIORITY_LABEL: Record<Priority, string> = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
};

function isCycleBatch(t: Task) {
  return t.tags.some(
    (tag) => tag === "周期批量" || tag === "还款提醒" || tag.startsWith("debt-remind:"),
  );
}

function isOpen(t: Task) {
  return t.status !== "done" && t.status !== "cancelled";
}

function dueMs(t: Task): number | null {
  if (!t.dueAt) return null;
  const n = new Date(t.dueAt).getTime();
  return Number.isFinite(n) ? n : null;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function withinDays(t: Task, days: number) {
  const due = dueMs(t);
  if (due == null) return false;
  const start = startOfToday();
  const end = start + days * 86400000;
  return due >= start - 86400000 && due < end;
}

function priorityLabel(p: string) {
  if (p === "high") return "高";
  if (p === "low") return "低";
  return "中";
}

function TaskRow({
  task,
  onComplete,
  onRemove,
}: {
  task: Task;
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const days = isCycleBatch(task) ? daysUntilDue(task) : null;
  const daysTone =
    days == null ? "" : days <= 0 ? "task-days--urgent" : days <= 1 ? "task-days--warn" : "task-days--ok";

  return (
    <div className="list-item task-row">
      <input
        type="checkbox"
        checked={task.status === "done"}
        onChange={() => onComplete(task.id)}
      />
      <div style={{ flex: 1 }}>
        <div className="task-row-main">
          <span style={{ textDecoration: task.status === "done" ? "line-through" : "none" }}>
            {task.title}
          </span>
          {days != null && (
            <strong className={`task-days ${daysTone}`}>{daysLeftLabel(days)}</strong>
          )}
        </div>
        <div className="muted">
          {priorityLabel(task.priority)}
          {task.dueAt &&
            ` · 应还 ${new Date(task.dueAt).toLocaleDateString("zh-CN", {
              month: "numeric",
              day: "numeric",
            })}`}
        </div>
        {isCycleBatch(task) && task.description && (
          <div className="muted task-desc">{task.description}</div>
        )}
      </div>
      <button className="btn btn-danger" onClick={() => onRemove(task.id)}>
        删除
      </button>
    </div>
  );
}

function TaskSection({
  title,
  hint,
  tasks,
  onComplete,
  onRemove,
}: {
  title: string;
  hint?: string;
  tasks: Task[];
  onComplete: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="panel task-section">
      <h3 className="section-label">
        {title}
        <span className="muted"> · {tasks.length}</span>
      </h3>
      {hint && <p className="muted hint">{hint}</p>}
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onComplete={onComplete} onRemove={onRemove} />
      ))}
    </section>
  );
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");

  const load = useCallback(async () => {
    setTasks(await api.taskList());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    await api.taskCreate({ title, priority });
    setTitle("");
    load();
  };

  const complete = async (id: string) => {
    await api.taskComplete(id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除此任务？")) return;
    await api.taskDelete(id);
    load();
  };

  const classified = useMemo(() => {
    const open = tasks.filter(isOpen);
    const regular = open.filter((t) => !isCycleBatch(t));
    const cycle = open.filter(isCycleBatch);

    const byPriority: Record<Priority, Task[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const t of regular) {
      const p = (t.priority as Priority) || "medium";
      byPriority[PRIORITY_ORDER.includes(p) ? p : "medium"].push(t);
    }

    const cycle7 = cycle
      .filter((t) => withinDays(t, 7))
      .sort((a, b) => (dueMs(a) ?? 0) - (dueMs(b) ?? 0));
    const cycle7Ids = new Set(cycle7.map((t) => t.id));
    const cycle30 = cycle
      .filter((t) => withinDays(t, 31) && !cycle7Ids.has(t.id))
      .sort((a, b) => (dueMs(a) ?? 0) - (dueMs(b) ?? 0));

    const done = tasks.filter((t) => t.status === "done");

    return { byPriority, cycle7, cycle30, done };
  }, [tasks]);

  return (
    <PageShell
      className="page-tasks"
      eyebrow="Tasks"
      title="任务"
      dock={
        <InputDock label="添加任务">
          <input
            placeholder="新任务标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            data-no-tab-swipe
          />
          <Select
            size="sm"
            ariaLabel="优先级"
            noTabSwipe
            value={priority}
            options={[
              { value: "high", label: "高" },
              { value: "medium", label: "中" },
              { value: "low", label: "低" },
            ]}
            onChange={(v) => setPriority(v as Priority)}
          />
          <button className="btn" type="button" onClick={create}>
            添加
          </button>
        </InputDock>
      }
    >
        <p className="muted hint" style={{ marginBottom: "1rem" }}>
          双重分类：日常任务按优先级；还款等周期批量任务仅出现在「近 7 天 / 近 1 月」。剩余天数按今天实时计算；弹窗：提前 3
          天（低）/ 前一天（中）/ 当天 17:00（高）。
        </p>

        <div className="task-dual">
          <div className="task-dual-col">
            <p className="eyebrow task-dual-eyebrow">优先级</p>
            {PRIORITY_ORDER.map((p) => (
              <TaskSection
                key={p}
                title={PRIORITY_LABEL[p]}
                tasks={classified.byPriority[p]}
                onComplete={complete}
                onRemove={remove}
              />
            ))}
            {PRIORITY_ORDER.every((p) => classified.byPriority[p].length === 0) && (
              <p className="empty-state compact">暂无日常任务</p>
            )}
          </div>

          <div className="task-dual-col">
            <p className="eyebrow task-dual-eyebrow">周期批量</p>
            <TaskSection
              title="近 7 天"
              hint="含还款提醒等周期性待办"
              tasks={classified.cycle7}
              onComplete={complete}
              onRemove={remove}
            />
            <TaskSection
              title="近 1 月"
              hint="7 天以外、一个月以内"
              tasks={classified.cycle30}
              onComplete={complete}
              onRemove={remove}
            />
            {classified.cycle7.length === 0 && classified.cycle30.length === 0 && (
              <p className="empty-state compact">近一个月暂无周期任务</p>
            )}
          </div>
        </div>

        {classified.done.length > 0 && (
          <section className="panel" style={{ marginTop: "1rem" }}>
            <h3 className="section-label">已完成</h3>
            {classified.done.map((t) => (
              <TaskRow key={t.id} task={t} onComplete={complete} onRemove={remove} />
            ))}
          </section>
        )}
    </PageShell>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api, Task } from "../services/api";

export type ReminderLevel = "low" | "medium" | "high";

export type DebtPopupItem = {
  key: string;
  level: ReminderLevel;
  title: string;
  body: string;
  daysLeft: number;
  amountHint?: string;
};

function parseDueDate(task: Task): Date | null {
  const tag = task.tags.find((t) => t.startsWith("debt-due:") || t.startsWith("plan-due:"));
  if (tag) {
    const raw = tag.replace(/^(debt-due:|plan-due:)/, "");
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    if (Number.isFinite(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  return null;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysUntilDue(task: Task, now = new Date()): number | null {
  const due = parseDueDate(task);
  if (!due) return null;
  return Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
}

export function daysLeftLabel(days: number): string {
  if (days > 0) return `还有 ${days} 天`;
  if (days === 0) return "今天到期";
  return `已逾期 ${Math.abs(days)} 天`;
}

/** Spec §5: 正好 3 天 = 低风险；≤1 天（含当天与逾期）= 高风险。其它天数不弹窗。 */
export function dueRiskLevel(days: number): ReminderLevel | null {
  if (days <= 1) return "high";
  if (days === 3) return "low";
  return null;
}

export function isDueReminder(t: Task) {
  return (
    t.status !== "done" &&
    t.status !== "cancelled" &&
    t.tags.some(
      (tag) =>
        tag.startsWith("debt-remind:") ||
        tag === "还款提醒" ||
        tag.startsWith("plan-remind:") ||
        tag === "计划提醒",
    )
  );
}

function isPlanReminder(t: Task) {
  return t.tags.some((tag) => tag.startsWith("plan-remind:") || tag === "计划提醒");
}

function seenKey(itemKey: string) {
  return `due-popup-seen:${itemKey}`;
}

function alreadySeen(itemKey: string) {
  try {
    return sessionStorage.getItem(seenKey(itemKey)) === "1";
  } catch {
    return false;
  }
}

function markSeen(itemKey: string) {
  try {
    sessionStorage.setItem(seenKey(itemKey), "1");
  } catch {
    /* ignore */
  }
}

/** Popup queue: day 3 = low, ≤1 day (incl. overdue) = high. */
export function buildDebtPopups(tasks: Task[], now = new Date()): DebtPopupItem[] {
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const out: DebtPopupItem[] = [];

  for (const t of tasks.filter(isDueReminder)) {
    const days = daysUntilDue(t, now);
    if (days == null) continue;
    const level = dueRiskLevel(days);
    if (!level) continue;

    const idTag =
      t.tags.find((x) => x.startsWith("debt-remind:") || x.startsWith("plan-remind:")) ?? t.id;
    const kind = days < 0 ? "overdue" : days === 0 ? "d0" : days === 1 ? "d1" : "d3";
    const key = `${idTag}:${todayStr}:${kind}`;
    if (alreadySeen(key)) continue;

    const plan = isPlanReminder(t);
    out.push({
      key,
      level,
      title: t.title.replace(/^\[?(还款提醒|计划提醒)\]?\s*[·•]?\s*/, "") || t.title,
      body: t.description?.trim() || (plan ? "请按时完成计划。" : "请按时还款。"),
      daysLeft: days,
      amountHint: undefined,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level] || a.daysLeft - b.daysLeft);
  return out;
}

const LEVEL_LABEL: Record<ReminderLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

type Props = {
  enabled: boolean;
};

export default function DebtReminderPopups({ enabled }: Props) {
  const [queue, setQueue] = useState<DebtPopupItem[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setQueue([]);
      return;
    }
    try {
      const tasks = await api.taskList();
      setQueue(buildDebtPopups(tasks));
    } catch {
      /* vault locked etc. */
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return;
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  const current = queue[0];
  if (!current) return null;

  const dismiss = () => {
    markSeen(current.key);
    setQueue((q) => q.slice(1));
  };

  return (
    <div className="debt-popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="debt-popup-title">
      <div className={`debt-popup debt-popup--${current.level}`}>
        <p className="debt-popup-level">{LEVEL_LABEL[current.level]}</p>
        <p className="debt-popup-days" id="debt-popup-title">
          {daysLeftLabel(current.daysLeft)}
        </p>
        <h3 className="debt-popup-title">{current.title}</h3>
        <p className="debt-popup-body">{current.body}</p>
        <button type="button" className="btn" onClick={dismiss}>
          知道了
        </button>
      </div>
    </div>
  );
}

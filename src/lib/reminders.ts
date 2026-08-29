/**
 * Shared reminder scheduling for desktop + mobile.
 * Uses system notifications when the plugin is available; no forked codepaths.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { api } from "../services/api";
import { daysUntilDue } from "../components/DebtReminderPopups";

function seenKey(key: string) {
  return `sys-notify:${key}`;
}

function alreadySent(key: string) {
  try {
    return localStorage.getItem(seenKey(key)) === "1";
  } catch {
    return false;
  }
}

function markSent(key: string) {
  try {
    localStorage.setItem(seenKey(key), "1");
  } catch {
    /* ignore */
  }
}

async function ensurePermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    return granted;
  } catch {
    return false;
  }
}

export async function refreshLocalReminders(): Promise<void> {
  const ok = await ensurePermission();
  if (!ok) return;

  const today = new Date();
  const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const hour = today.getHours();

  try {
    const [tasks, habits, goals] = await Promise.all([
      api.taskList(),
      api.habitList(),
      api.goalList(),
    ]);

    for (const t of tasks) {
      if (t.status === "done" || t.status === "cancelled") continue;
      if (!t.tags?.some((x) => x.startsWith("debt-remind:") || x === "还款提醒")) continue;
      const days = daysUntilDue(t, today);
      if (days == null) continue;
      let kind: string | null = null;
      let title = "还款提醒";
      if (days < 0) kind = "overdue";
      else if (days === 0 && hour >= 17) kind = "d0";
      else if (days === 1) kind = "d1";
      else if (days === 3) kind = "d3";
      if (!kind) continue;
      const key = `${t.id}:${dayKey}:${kind}`;
      if (alreadySent(key)) continue;
      if (kind === "d3") title = "还款提前提醒";
      else if (kind === "d1") title = "明日还款";
      else title = "今日应还";
      await sendNotification({ title, body: t.title });
      markSent(key);
    }

    const unchecked = habits.filter((h) => !h.checkedToday);
    if (unchecked.length > 0 && hour >= 20) {
      const key = `habits:${dayKey}`;
      if (!alreadySent(key)) {
        await sendNotification({
          title: "习惯打卡",
          body: `还有 ${unchecked.length} 个习惯今天未完成`,
        });
        markSent(key);
      }
    }

    for (const g of goals.filter((x) => x.status === "active" && x.targetDate)) {
      const due = new Date(g.targetDate!);
      if (!Number.isFinite(due.getTime())) continue;
      const days = Math.round(
        (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
          new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
          86400000,
      );
      if (days !== 3 && days !== 1 && days !== 0) continue;
      const key = `goal:${g.id}:${dayKey}`;
      if (alreadySent(key)) continue;
      await sendNotification({
        title: days === 0 ? "目标日到了" : `目标还有 ${days} 天`,
        body: g.title,
      });
      markSent(key);
    }
  } catch {
    /* vault / plugin unavailable */
  }
}

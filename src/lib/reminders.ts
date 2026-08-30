/**
 * Shared reminder scheduling for the pure-web build.
 * Uses the browser Web Notifications API when available and permitted.
 */
import { api } from "../services/api";

async function isPermissionGranted(): Promise<boolean> {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  return Notification.requestPermission();
}

function sendNotification(payload: { title: string; body: string }): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(payload.title, { body: payload.body });
  } catch {
    /* ignore notification failures */
  }
}
import { daysUntilDue, dueRiskLevel, isDueReminder } from "../components/DebtReminderPopups";

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
    const [tasks, goals] = await Promise.all([api.taskList(), api.goalList()]);

    for (const t of tasks) {
      if (!isDueReminder(t)) continue;
      const days = daysUntilDue(t, today);
      if (days == null) continue;
      const level = dueRiskLevel(days);
      if (!level) continue;
      const kind = days < 0 ? "overdue" : days === 0 ? "d0" : days === 1 ? "d1" : "d3";
      const key = `${t.id}:${dayKey}:${kind}`;
      if (alreadySent(key)) continue;
      const isPlan = t.tags?.some((x) => x.startsWith("plan-remind:") || x === "计划提醒");
      let title = isPlan ? "计划提醒" : "还款提醒";
      if (isPlan) {
        if (level === "low") title = "计划提前提醒";
        else if (days === 1) title = "明日计划截止";
        else if (days < 0) title = "计划已逾期";
        else title = "今日计划截止";
      } else if (level === "low") title = "还款提前提醒";
      else if (days === 1) title = "明日还款";
      else if (days < 0) title = "还款已逾期";
      else title = "今日应还";
      await sendNotification({ title, body: t.title });
      markSent(key);
    }

    const pending = goals.filter(
      (g) =>
        (g.kind === "checkin" || g.kind === "habit") &&
        g.status === "active" &&
        !g.formed &&
        !g.checkedToday,
    );
    if (pending.length > 0 && hour >= 20) {
      const key = `checkins:${dayKey}`;
      if (!alreadySent(key)) {
        const names = pending
          .slice(0, 3)
          .map((g) => g.title)
          .join("、");
        await sendNotification({
          title: "养成提醒",
          body:
            pending.length === 1
              ? `${names} 尚未打卡`
              : `${names}${pending.length > 3 ? "…" : ""} 等 ${pending.length} 项尚未打卡`,
        });
        markSent(key);
      }
    }
  } catch {
    /* vault / plugin unavailable */
  }
}

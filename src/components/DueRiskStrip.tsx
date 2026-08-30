import { daysLeftLabel, daysUntilDue, dueRiskLevel, isDueReminder } from "./DebtReminderPopups";
import type { Task } from "../services/api";

export type DueGlance = {
  level: "high" | "low" | "none";
  text: string;
  hint: string;
};

export function glanceDueRisk(tasks: Task[], now = new Date()): DueGlance {
  const scored = tasks
    .filter(isDueReminder)
    .map((t) => {
      const days = daysUntilDue(t, now);
      const level = days == null ? null : dueRiskLevel(days);
      return { t, days, level };
    })
    .filter((x): x is { t: Task; days: number; level: "high" | "low" | null } => x.days != null);

  const high = scored.filter((x) => x.level === "high").sort((a, b) => a.days - b.days);
  const low = scored.filter((x) => x.level === "low");
  if (high[0]) {
    const h = high[0];
    return {
      level: "high",
      text: `高风险 · ${daysLeftLabel(h.days)} · ${h.t.title}`,
      hint: high.length > 1 ? `另有 ${high.length - 1} 项` : "",
    };
  }
  if (low[0]) {
    const l = low[0];
    return {
      level: "low",
      text: `低风险 · ${daysLeftLabel(l.days)} · ${l.t.title}`,
      hint: "",
    };
  }
  const week = scored.filter((x) => x.days < 7);
  return {
    level: "none",
    text: week.length === 0 ? "近 7 天无到期" : `近 7 天 ${week.length} 项待办`,
    hint: "",
  };
}

type Props = {
  tasks: Task[];
  compact?: boolean;
  onOpen?: () => void;
};

export default function DueRiskStrip({ tasks, compact, onOpen }: Props) {
  const g = glanceDueRisk(tasks);
  const body = (
    <>
      <span className={`risk-chip risk-chip--${g.level}`}>{g.level === "none" ? "到期" : g.level === "high" ? "高" : "低"}</span>
      <span className="risk-strip-text">{g.text}</span>
      {g.hint ? <span className="muted">{g.hint}</span> : null}
    </>
  );
  if (onOpen) {
    return (
      <button type="button" className={`risk-strip ${compact ? "risk-strip--compact" : ""}`} onClick={onOpen}>
        {body}
      </button>
    );
  }
  return <div className={`risk-strip ${compact ? "risk-strip--compact" : ""}`}>{body}</div>;
}

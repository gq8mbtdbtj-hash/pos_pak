import { useCallback, useEffect, useState } from "react";
import { EDIT_PAY_SNAPSHOT } from "../lib/glance";
import { api, type PayPeriodPending, type PayPeriodSnapshot } from "../services/api";

type Props = {
  enabled: boolean;
};

type Draft = {
  snapshotId?: string;
  periodStart: string;
  periodLabel: string;
  income: number;
  expense: number;
  net: number;
  note: string;
};

function seenKey(periodStart: string) {
  return `pay-snapshot-popup:${periodStart}`;
}

function alreadySeen(periodStart: string) {
  try {
    return sessionStorage.getItem(seenKey(periodStart)) === "1";
  } catch {
    return false;
  }
}

function markSeen(periodStart: string) {
  try {
    sessionStorage.setItem(seenKey(periodStart), "1");
  } catch {
    /* ignore */
  }
}

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function notifyFinanceChanged() {
  window.dispatchEvent(new CustomEvent("personal-os:prefs-changed"));
}

function fromPending(p: PayPeriodPending): Draft {
  return {
    periodStart: p.periodStart,
    periodLabel: p.periodLabel,
    income: p.income,
    expense: p.expense,
    net: p.net,
    note: "",
  };
}

function fromSnapshot(s: PayPeriodSnapshot): Draft {
  return {
    snapshotId: s.id,
    periodStart: s.periodStart,
    periodLabel: s.periodLabel,
    income: s.income,
    expense: s.expense,
    net: s.net,
    note: s.note ?? "",
  };
}

export default function PayPeriodConfirmPopup({ enabled }: Props) {
  const [pending, setPending] = useState<PayPeriodPending | null>(null);
  const [snapshots, setSnapshots] = useState<PayPeriodSnapshot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [forced, setForced] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setPending(null);
      setSnapshots([]);
      return;
    }
    try {
      const s = await api.financeSummary();
      setPending(s.pendingSnapshot ?? null);
      setSnapshots(s.snapshots ?? []);
    } catch {
      setPending(null);
      setSnapshots([]);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || forced || draft) return;
    if (pending && !alreadySeen(pending.periodStart)) {
      setDraft(fromPending(pending));
    }
  }, [enabled, pending, forced, draft]);

  useEffect(() => {
    const onEdit = (ev: Event) => {
      const id = (ev as CustomEvent<{ snapshotId?: string }>).detail?.snapshotId;
      void (async () => {
        let list = snapshots;
        let pend = pending;
        if (id && !list.some((x) => x.id === id)) {
          try {
            const s = await api.financeSummary();
            list = s.snapshots ?? [];
            pend = s.pendingSnapshot ?? null;
            setSnapshots(list);
            setPending(pend);
          } catch {
            /* ignore */
          }
        }
        if (id) {
          const found = list.find((x) => x.id === id);
          if (found) {
            setForced(true);
            setDraft(fromSnapshot(found));
            return;
          }
        }
        if (pend) {
          setForced(true);
          setDraft(fromPending(pend));
          return;
        }
        const latest = list[0];
        if (latest) {
          setForced(true);
          setDraft(fromSnapshot(latest));
        }
      })();
    };
    window.addEventListener(EDIT_PAY_SNAPSHOT, onEdit);
    return () => window.removeEventListener(EDIT_PAY_SNAPSHOT, onEdit);
  }, [pending, snapshots]);

  const close = (rememberLater: boolean) => {
    if (draft && rememberLater && !draft.snapshotId) {
      markSeen(draft.periodStart);
    }
    setDraft(null);
    setForced(false);
  };

  const save = async () => {
    if (!draft || busy) return;
    const net = Number(draft.net);
    if (!Number.isFinite(net)) return;
    setBusy(true);
    try {
      if (draft.snapshotId) {
        await api.financeUpdatePayPeriod(draft.snapshotId, {
          net,
          note: draft.note,
        });
      } else {
        await api.financeConfirmPayPeriod({ net, note: draft.note });
      }
      markSeen(draft.periodStart);
      setDraft(null);
      setForced(false);
      notifyFinanceChanged();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!enabled || !draft) return null;

  const book = draft.income - draft.expense;
  const adjusted = Math.abs(draft.net - book) > 0.005;

  return (
    <div className="debt-popup-backdrop pay-snap-popup" role="dialog" aria-modal="true" aria-labelledby="pay-snap-title">
      <div className={`debt-popup ${draft.net >= 0 ? "debt-popup--low" : "debt-popup--high"}`}>
        <p className="debt-popup-level">{draft.snapshotId ? "修正结余" : "上期结余待确认"}</p>
        <h3 className="debt-popup-title" id="pay-snap-title">
          {draft.periodLabel}
        </h3>
        <p className="debt-popup-body">
          账单收入 ¥{money(draft.income)} · 支出 ¥{money(draft.expense)} · 合计{" "}
          {book >= 0 ? "+" : ""}¥{money(book)}
          {adjusted ? "（可按现金盘点修正下面的结余）" : "。可按现金盘点修正结余。"}
          确认后将作为下期期初，计入有效结余。
        </p>
        <label className="field pay-snap-field">
          <span>结余（元）</span>
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={Number.isFinite(draft.net) ? String(draft.net) : ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                net: e.target.value === "" ? Number.NaN : Number(e.target.value),
              })
            }
            data-no-tab-swipe
          />
        </label>
        <label className="field pay-snap-field">
          <span>备注（可选）</span>
          <input
            placeholder="例如：现金盘点差 20"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            data-no-tab-swipe
          />
        </label>
        <div className="debt-popup-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(true)} disabled={busy}>
            稍后
          </button>
          <button type="button" className="btn" onClick={() => void save()} disabled={busy || !Number.isFinite(draft.net)}>
            {busy ? "保存中…" : draft.snapshotId ? "保存修正" : "确认存档"}
          </button>
        </div>
      </div>
    </div>
  );
}

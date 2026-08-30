import type { PayPeriodSnapshot } from "../services/api";
import { openPaySnapshotEditor } from "../lib/glance";

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

type Props = {
  snapshots: PayPeriodSnapshot[];
  /** Label of the period currently used as opening (期初). */
  openingPeriodLabel?: string | null;
  /** Current effective surplus for contrast (not drawn as a second axis). */
  effective?: number | null;
};

export default function SurplusHistory({
  snapshots,
  openingPeriodLabel,
  effective,
}: Props) {
  const data = [...snapshots].slice(0, 8).reverse();
  if (data.length === 0) {
    return (
      <p className="empty-state compact">
        确认上期结余后，这里会留下近几期记录，并作为下期期初。点柱可修正。
      </p>
    );
  }
  const maxAbs = Math.max(
    1,
    ...data.map((d) => Math.abs(d.net)),
    effective != null ? Math.abs(effective) : 0,
  );
  return (
    <div className="surplus-history" aria-label="近几期结余">
      {data.map((s) => {
        const h = Math.max(8, (Math.abs(s.net) / maxAbs) * 72);
        const pos = s.net >= 0;
        const book = s.income - s.expense;
        const adjusted = Math.abs(s.net - book) > 0.005;
        const isOpening = Boolean(openingPeriodLabel && s.periodLabel === openingPeriodLabel);
        return (
          <button
            key={s.id}
            type="button"
            className="surplus-col surplus-col--btn"
            onClick={() => openPaySnapshotEditor(s.id)}
          >
            <span className={`surplus-val ${pos ? "amount-income" : "amount-expense"}`}>
              {pos ? "+" : ""}¥{money(s.net)}
            </span>
            <div className="surplus-bar-track">
              <div
                className={`surplus-bar ${pos ? "surplus-bar--pos" : "surplus-bar--neg"}`}
                style={{ height: `${h}px` }}
              />
            </div>
            <span className="muted surplus-label">{s.periodLabel}</span>
            {isOpening ? <span className="muted surplus-label">期初</span> : null}
            {adjusted ? <span className="muted surplus-label">已修正</span> : null}
          </button>
        );
      })}
      {effective != null ? (
        <div className="surplus-col surplus-col--now" aria-label="当前有效结余">
          <span
            className={`surplus-val ${effective >= 0 ? "amount-income" : "amount-expense"}`}
          >
            {effective >= 0 ? "+" : ""}¥{money(effective)}
          </span>
          <div className="surplus-bar-track">
            <div
              className={`surplus-bar ${effective >= 0 ? "surplus-bar--pos" : "surplus-bar--neg"} surplus-bar--now`}
              style={{ height: `${Math.max(8, (Math.abs(effective) / maxAbs) * 72)}px` }}
            />
          </div>
          <span className="muted surplus-label">本期有效</span>
        </div>
      ) : null}
    </div>
  );
}

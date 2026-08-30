import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  Debt,
  DebtDetail,
  DebtOverview,
  RepaymentMode,
  RepaymentPlan,
} from "../services/api";
import { showToast } from "../components/Toast";
import PageShell from "../components/PageShell";

function progress(debt: Debt) {
  if (debt.principal <= 0) return 100;
  return Math.min(100, Math.max(0, ((debt.principal - debt.remaining) / debt.principal) * 100));
}

function statusLabel(status: Debt["status"]) {
  if (status === "paid") return "已结清";
  if (status === "paused") return "暂停";
  return "进行中";
}

function modeLabel(mode: RepaymentMode | string | undefined) {
  if (mode === "interest_balloon") return "先息后本";
  return "等额本息";
}

function money(n: number) {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function previewPlan(
  remaining: number,
  annualRate: number,
  mode: RepaymentMode,
  termMonths: number,
): { monthly: number; last: number; totalInterest: number; note: string } | null {
  const n = termMonths;
  if (!(remaining > 0) || !(n >= 1)) return null;
  const r = annualRate / 100 / 12;

  if (mode === "interest_balloon") {
    if (!(annualRate > 0)) {
      return {
        monthly: 0,
        last: remaining,
        totalInterest: 0,
        note: "先息后本需要年利率",
      };
    }
    const interest = Math.round(remaining * r * 100) / 100;
    return {
      monthly: interest,
      last: Math.round((remaining + interest) * 100) / 100,
      totalInterest: Math.round(interest * n * 100) / 100,
      note: `前 ${n - 1} 期只还利息，第 ${n} 期还本金 + 利息`,
    };
  }

  const payment =
    Math.abs(r) < 1e-12
      ? Math.round((remaining / n) * 100) / 100
      : Math.round(((remaining * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) * 100) / 100;

  let balance = remaining;
  let totalInterest = 0;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(balance * r * 100) / 100;
    totalInterest += interest;
    const principalPart =
      i === n ? balance : Math.min(balance, Math.max(0, Math.round((payment - interest) * 100) / 100));
    balance = Math.max(0, balance - principalPart);
  }

  return {
    monthly: payment,
    last: payment,
    totalInterest: Math.round(totalInterest * 100) / 100,
    note: annualRate > 0 ? "每月本息合计固定" : "年利率为 0，按本金均摊",
  };
}

export default function DebtsPage({
  onNavigate,
}: {
  onNavigate: (page: "finance") => void;
}) {
  const [overview, setOverview] = useState<DebtOverview | null>(null);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DebtDetail | null>(null);

  const [name, setName] = useState("");
  const [creditor, setCreditor] = useState("");
  const [principal, setPrincipal] = useState("");
  const [remaining, setRemaining] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");

  const [payAmount, setPayAmount] = useState("");
  const [planMode, setPlanMode] = useState<RepaymentMode>("equal_payment");
  const [planTerm, setPlanTerm] = useState("12");
  const [planStart, setPlanStart] = useState("");
  const [editRate, setEditRate] = useState("");

  const flash = (text: string, kind: "ok" | "err" | "info" = "ok") => {
    showToast(kind, text);
  };

  const load = useCallback(async () => {
    const [o, list] = await Promise.all([api.debtOverview(), api.debtList()]);
    setOverview(o);
    setDebts(list);
    if (selectedId) {
      const still = list.find((d) => d.id === selectedId);
      if (still) {
        setDetail(await api.debtDetail(selectedId));
      } else {
        setSelectedId(null);
        setDetail(null);
      }
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectDebt = async (id: string) => {
    setSelectedId(id);
    const d = await api.debtDetail(id);
    setDetail(d);
    setEditRate(d.debt.annualRate > 0 ? String(d.debt.annualRate) : "");
  };

  const saveRate = async () => {
    if (!selectedId) return;
    const annualRate = editRate.trim() ? Number(editRate) : 0;
    if (editRate.trim() && !(annualRate >= 0)) {
      flash("年利率无效", "err");
      return;
    }
    await api.debtUpdate(selectedId, { annualRate });
    flash("已更新年利率");
    await load();
    await selectDebt(selectedId);
  };

  const createDebt = async () => {
    const p = Number(principal);
    if (!name.trim() || !(p > 0)) {
      flash("请填写名称和本金", "err");
      return;
    }
    const r = remaining.trim() ? Number(remaining) : undefined;
    const debt = await api.debtCreate({
      name: name.trim(),
      creditor: creditor.trim() || undefined,
      principal: p,
      remaining: r,
      annualRate: rate.trim() ? Number(rate) : undefined,
      note: note.trim() || undefined,
    });
    setName("");
    setCreditor("");
    setPrincipal("");
    setRemaining("");
    setRate("");
    setNote("");
    flash("已添加外债");
    await load();
    await selectDebt(debt.id);
  };

  const removeDebt = async (id: string) => {
    if (!confirm("确定删除该外债及关联还款计划？")) return;
    await api.debtDelete(id);
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
    }
    flash("已删除");
    load();
  };

  const addPayment = async () => {
    if (!selectedId) return;
    const amount = Number(payAmount);
    if (!(amount > 0)) {
      flash("请输入还款金额", "err");
      return;
    }
    await api.debtAddPayment(selectedId, { amount, note: "手动还款" });
    setPayAmount("");
    flash("已记录还款（计入本金）");
    await load();
    await selectDebt(selectedId);
  };

  const payInstallment = async (installmentId: string) => {
    const next = await api.debtPayInstallment(installmentId);
    setDetail(next);
    setSelectedId(next.debt.id);
    flash("已按计划还款");
    load();
  };

  const activePlan: RepaymentPlan | undefined = detail?.plans.find((p) => p.status === "active");

  // 选中外债或计划变化时，用现有计划预填可编辑表单
  useEffect(() => {
    if (!activePlan) return;
    setPlanMode(activePlan.planMode === "interest_balloon" ? "interest_balloon" : "equal_payment");
    if (activePlan.termMonths > 0) setPlanTerm(String(activePlan.termMonths));
    if (activePlan.startDate) setPlanStart(activePlan.startDate.slice(0, 10));
  }, [activePlan?.id, activePlan?.planMode, activePlan?.termMonths, activePlan?.startDate]);

  const planPreview = useMemo(() => {
    if (!detail) return null;
    const term = Number(planTerm);
    return previewPlan(detail.debt.remaining, detail.debt.annualRate, planMode, term);
  }, [detail, planMode, planTerm]);

  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const updateOrCreatePlan = async () => {
    if (!selectedId || !detail) return;
    const termMonths = Number(planTerm);
    if (!(termMonths >= 1)) {
      flash("请输入期数（月）", "err");
      return;
    }
    if (planMode === "interest_balloon" && !(detail.debt.annualRate > 0)) {
      flash("先息后本需要年利率，请先保存年利率", "err");
      return;
    }
    if (activePlan) {
      const ok = confirm("将取消当前进行中的计划并生成新计划，已还记录保留在还款流水中。继续？");
      if (!ok) return;
    }
    try {
      await api.debtCreatePlan(selectedId, {
        mode: planMode,
        termMonths,
        startDate: planStart || undefined,
        title: `${modeLabel(planMode)} · ${termMonths}期`,
      });
      flash(activePlan ? "已更新还款计划" : "已生成还款计划");
      await load();
      await selectDebt(selectedId);
    } catch (e) {
      flash(String(e), "err");
    }
  };

  const renderPlanEditor = (hasPlan: boolean) => (
    <div className="action-block plan-editor">
      <h4 className="section-label">{hasPlan ? "更新还款计划" : "生成还款计划"}</h4>
      <p className="muted hint">
        {hasPlan
          ? "修改下方参数后可重新生成计划；当前计划（上方只读）不会被直接改写，而是整份替换。"
          : "按剩余本金与年利率生成分期表，生成后可按期还款。"}
      </p>
      <div className="mode-toggle" role="group" aria-label="还款方式">
        <button
          type="button"
          className={`mode-chip ${planMode === "equal_payment" ? "active" : ""}`}
          onClick={() => setPlanMode("equal_payment")}
        >
          等额本息
          <small>利息 + 本金</small>
        </button>
        <button
          type="button"
          className={`mode-chip ${planMode === "interest_balloon" ? "active" : ""}`}
          onClick={() => setPlanMode("interest_balloon")}
        >
          先息后本
          <small>前期只还息，到期还本</small>
        </button>
      </div>
      <div className="debt-action-stack">
        <label className="field">
          <span>期数（月）</span>
          <input
            placeholder="例如 12"
            value={planTerm}
            onChange={(e) => setPlanTerm(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="field">
          <span>首次还款日</span>
          <input type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
        </label>
        {planPreview && (
          <div className="plan-preview">
            <div>
              <span className="muted">月供参考</span>
              <strong>¥{money(planPreview.monthly)}</strong>
            </div>
            {planMode === "interest_balloon" && (
              <div>
                <span className="muted">到期应还</span>
                <strong>¥{money(planPreview.last)}</strong>
              </div>
            )}
            <div>
              <span className="muted">预计总利息</span>
              <strong>¥{money(planPreview.totalInterest)}</strong>
            </div>
            <p className="muted">{planPreview.note}</p>
          </div>
        )}
        <button className="btn" type="button" onClick={updateOrCreatePlan}>
          {hasPlan ? "更新并生成新计划" : "生成计划"}
        </button>
      </div>
    </div>
  );

  return (
    <PageShell
      className="page-debts"
      eyebrow="Liabilities"
      title="外债"
      actions={
        <div className="segmented segmented--jump" role="group" aria-label="返回记账">
          <button type="button" onClick={() => onNavigate("finance")}>
            记账
          </button>
        </div>
      }
    >
      {overview && (
        <section className="panel">
          <div className="flow-strip">
            <div className="flow-stat">
              <span>剩余债务</span>
              <strong className="amount-expense">¥{money(overview.totalRemaining)}</strong>
            </div>
            <div className="flow-stat">
              <span>本金合计</span>
              <strong>¥{money(overview.totalPrincipal)}</strong>
            </div>
            <div className="flow-stat">
              <span>月供合计</span>
              <strong>¥{money(overview.monthlyObligation)}</strong>
            </div>
            <div className="flow-stat">
              <span>进行中</span>
              <strong>{overview.activeCount}</strong>
            </div>
          </div>
        </section>
      )}

      {overview && overview.upcoming.length > 0 && (
        <section className="panel">
          <h3 className="section-label">近期应还 · 近两个月</h3>
          <div className="upcoming-list">
            {overview.upcoming.map((u) => (
              <div key={u.installmentId} className="upcoming-row">
                <div>
                  <strong>{u.debtName}</strong>
                  <span className="muted"> · {u.planTitle}</span>
                </div>
                <div className="upcoming-meta">
                  <span className="muted">{u.dueDate}</span>
                  <strong className="amount-expense">¥{money(u.amount)}</strong>
                  <button className="btn" onClick={() => payInstallment(u.installmentId)}>
                    还款
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="debt-layout">
        <section className="panel debt-list-panel">
          <h3 className="section-label">外债列表</h3>
          {debts.length === 0 ? (
            <p className="empty-state compact">暂无外债</p>
          ) : (
            debts.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`debt-card ${selectedId === d.id ? "active" : ""}`}
                onClick={() => selectDebt(d.id)}
              >
                <div className="debt-card-top">
                  <strong>{d.name}</strong>
                  <span className={`debt-status ${d.status}`}>{statusLabel(d.status)}</span>
                </div>
                {d.creditor && <div className="muted">{d.creditor}</div>}
                <div className="debt-card-amounts">
                  <span className="amount-expense">剩 ¥{money(d.remaining)}</span>
                  <span className="muted"> / ¥{money(d.principal)}</span>
                </div>
                {d.annualRate > 0 && (
                  <div className="muted debt-card-rate">年利率 {d.annualRate}%</div>
                )}
                <div className="debt-progress">
                  <div className="debt-progress-fill" style={{ width: `${progress(d)}%` }} />
                </div>
              </button>
            ))
          )}
        </section>

        <section className="panel debt-detail-panel">
          {!detail ? (
            <p className="empty-state">选择一笔外债查看还款计划</p>
          ) : (
            <>
              <div className="debt-detail-head">
                <div>
                  <h3>{detail.debt.name}</h3>
                  <p className="muted">{detail.debt.creditor || "未填债权人"}</p>
                  <p className="debt-detail-balance">
                    剩余本金 <strong className="amount-expense">¥{money(detail.debt.remaining)}</strong>
                    <span className="muted"> / ¥{money(detail.debt.principal)}</span>
                  </p>
                  <div className="debt-rate-edit">
                    <label className="field">
                      <span>年利率 %</span>
                      <input
                        value={editRate}
                        onChange={(e) => setEditRate(e.target.value)}
                        inputMode="decimal"
                        placeholder="例如 6.5"
                      />
                    </label>
                    <button className="btn btn-ghost" type="button" onClick={saveRate}>
                      保存利率
                    </button>
                  </div>
                </div>
                <button className="btn btn-ghost danger" onClick={() => removeDebt(detail.debt.id)}>
                  删除
                </button>
              </div>

              {activePlan ? (
                <div className="plan-block plan-block--readonly">
                  <div className="plan-block-head">
                    <h4 className="section-label">
                      当前还款计划
                      <span className="plan-readonly-badge">只读</span>
                    </h4>
                    <p className="muted plan-block-meta">
                      {modeLabel(activePlan.planMode)} · {activePlan.termMonths || "—"} 期
                      {activePlan.monthlyAmount > 0
                        ? ` · 月供 ¥${money(activePlan.monthlyAmount)}`
                        : ""}
                      {activePlan.startDate ? ` · 起息 ${activePlan.startDate.slice(0, 10)}` : ""}
                    </p>
                    <p className="muted hint">
                      下方分期表为已生成计划原文；点击「还这期」按该期本金/利息如实记账。
                    </p>
                  </div>
                  <div className="installment-list">
                    <div className="installment-row installment-head" aria-hidden="true">
                      <span>期</span>
                      <span>日期</span>
                      <span>本金</span>
                      <span>利息</span>
                      <span>合计</span>
                      <span>状态</span>
                      <span />
                    </div>
                    {activePlan.installments.map((i) => {
                      const overdue = i.status === "pending" && i.dueDate < todayStr;
                      const statusText =
                        i.status === "paid"
                          ? "已还"
                          : i.status === "skipped"
                            ? "跳过"
                            : overdue
                              ? "逾期"
                              : "待还";
                      return (
                        <div
                          key={i.id}
                          className={`installment-row ${i.status}${overdue ? " overdue" : ""}`}
                        >
                          <div className="installment-row__top">
                            <strong className="installment-row__seq">#{i.sequence}</strong>
                            <span className="installment-row__date">{i.dueDate}</span>
                            <span
                              className={`installment-row__status${overdue ? " is-overdue" : ""}`}
                            >
                              {statusText}
                            </span>
                          </div>
                          <div className="installment-row__amounts">
                            <span>
                              <em>本金</em>¥{money(i.principalAmount ?? 0)}
                            </span>
                            <span>
                              <em>利息</em>¥{money(i.interestAmount ?? 0)}
                            </span>
                            <strong>
                              <em>合计</em>¥{money(i.amount)}
                            </strong>
                          </div>
                          {i.status === "pending" ? (
                            <button
                              className="btn installment-row__action"
                              type="button"
                              onClick={() => payInstallment(i.id)}
                            >
                              还这期
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="empty-state compact">
                  尚未生成还款计划，请在下方配置后生成。
                </p>
              )}

              {detail.payments.length > 0 && (
                <div className="payment-history">
                  <h4 className="section-label">还款记录</h4>
                  {detail.payments.map((p) => (
                    <div key={p.id} className="list-item">
                      <span>{new Date(p.paidAt).toLocaleString()}</span>
                      <strong className="amount-expense">-¥{money(p.amount)}</strong>
                      <span className="muted">
                        {[
                          p.principalAmount != null && p.principalAmount > 0
                            ? `本金 ¥${money(p.principalAmount)}`
                            : null,
                          p.interestAmount != null && p.interestAmount > 0
                            ? `利息 ¥${money(p.interestAmount)}`
                            : null,
                          p.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="debt-actions debt-actions--edit">
                <p className="section-label debt-edit-label">编辑</p>
                {renderPlanEditor(!!activePlan)}

                <div className="action-block">
                  <h4 className="section-label">手动还款</h4>
                  <p className="muted hint">不走分期表时使用；整笔记入本金扣减（提前还本等）。</p>
                  <div className="debt-action-stack">
                    <label className="field">
                      <span>金额（元）</span>
                      <input
                        placeholder="例如 5000"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <button className="btn" type="button" onClick={addPayment}>
                      记账还款
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="panel">
        <h3 className="section-label">新增外债</h3>
        <div className="debt-form">
          <label className="field">
            <span>名称</span>
            <input
              placeholder="例如：消费贷 / 招行信用卡"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>债权人</span>
            <input
              placeholder="可选"
              value={creditor}
              onChange={(e) => setCreditor(e.target.value)}
            />
          </label>
          <label className="field">
            <span>本金（元）</span>
            <input
              placeholder="必填"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span>剩余本金</span>
            <input
              placeholder="默认等于本金"
              value={remaining}
              onChange={(e) => setRemaining(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span>年利率 %</span>
            <input
              placeholder="先息后本 / 等额本息需要"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="field">
            <span>备注</span>
            <input placeholder="可选" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="debt-form-actions">
            <button className="btn" onClick={createDebt}>
              添加外债
            </button>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

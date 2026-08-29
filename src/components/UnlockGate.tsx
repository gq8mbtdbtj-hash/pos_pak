import { useEffect, useState } from "react";
import { api, VaultStatus, SyncPullResult, GitCommitInfo } from "../services/api";
import { toastErr } from "./Toast";

type Props = {
  onUnlocked: (status: VaultStatus) => void;
};

export default function UnlockGate({ onUnlocked }: Props) {
  const [mode, setMode] = useState<"loading" | "init" | "unlock" | "create">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<SyncPullResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const auto = await api.vaultTryAutoUnlock();
        if (cancelled) return;
        if (auto.unlocked) {
          await finishUnlock(auto);
          return;
        }
        setMode(auto.initialized ? "unlock" : "init");
      } catch (e) {
        if (cancelled) return;
        toastErr(String(e));
        setMode("init");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishUnlock = async (status: VaultStatus) => {
    if (status.needsDefaultRemote) {
      onUnlocked(status);
      return;
    }
    if (status.syncConfigured) {
      try {
        const pull = await api.syncPull();
        if (pull.status === "conflict") {
          setConflict(pull);
          return;
        }
      } catch (e) {
        console.warn("startup pull failed", e);
        toastErr(String(e));
      }
    }
    try {
      const refreshed = await api.vaultStatus();
      onUnlocked(refreshed);
    } catch {
      onUnlocked(status);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "init" || mode === "create") {
        if (password.length < 8) {
          toastErr("主密码至少 8 位");
          return;
        }
        if (password !== confirm) {
          toastErr("两次输入不一致");
          return;
        }
        const status = await api.vaultInit(password);
        await finishUnlock(status);
      } else {
        const status = await api.vaultUnlock(password);
        await finishUnlock(status);
      }
    } catch (e) {
      toastErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolveCommit = async (commit: GitCommitInfo) => {
    setBusy(true);
    try {
      await api.syncResolveCommit(commit.id);
      const status = await api.vaultStatus();
      setConflict(null);
      onUnlocked(status);
    } catch (e) {
      toastErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (conflict?.conflict) {
    return (
      <div className="unlock-screen">
        <div className="unlock-card">
          <h1>同步冲突</h1>
          <p className="muted">{conflict.conflict.message}</p>
          <ul className="commit-list">
            {conflict.conflict.commits.map((c) => (
              <li key={c.id}>
                <button className="btn commit-pick" disabled={busy} onClick={() => resolveCommit(c)}>
                  <strong>{c.shortId}</strong>
                  <span>{c.summary}</span>
                  <span className="muted">
                    {c.author} · {c.time}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const title =
    mode === "init"
      ? "设置主密码以加密本地数据与同步凭证"
      : mode === "create"
        ? "创建新的独立数据空间（新密码对应独立数据与远端配置）"
        : mode === "loading"
          ? "正在检查本地会话…"
          : "输入主密码解锁对应数据空间";

  return (
    <div className="unlock-screen">
      <div className="unlock-card">
        <div className="unlock-brand">
          <span className="brand-mark" aria-hidden />
          <h1>Personal OS</h1>
        </div>
        <p className="muted">{title}</p>
        <div className="form-col">
          <input
            className="unlock-input"
            type="password"
            placeholder="主密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
            autoFocus
            disabled={mode === "loading"}
            autoComplete="new-password"
          />
          {(mode === "init" || mode === "create") && (
            <input
              className="unlock-input"
              type="password"
              placeholder="确认主密码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
              autoComplete="new-password"
            />
          )}
          {password.length > 0 && (
            <p className="muted unlock-len">已输入 {password.length} 位</p>
          )}
          <button className="btn" disabled={busy || mode === "loading"} onClick={submit}>
            {busy
              ? "处理中…"
              : mode === "init" || mode === "create"
                ? "创建并解锁"
                : "解锁"}
          </button>
          {mode === "unlock" && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode("create");
                setPassword("");
                setConfirm("");
              }}
            >
              用新密码创建独立空间
            </button>
          )}
          {mode === "create" && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setMode("unlock");
                setPassword("");
                setConfirm("");
              }}
            >
              返回解锁已有空间
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

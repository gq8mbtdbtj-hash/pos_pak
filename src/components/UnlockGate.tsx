import { useEffect, useRef, useState } from "react";
import { api, VaultStatus } from "../services/api";
import { toastErr } from "./Toast";

type Props = {
  onUnlocked: (status: VaultStatus) => void;
};

type Mode = "loading" | "auto" | "init" | "unlock" | "create";

export default function UnlockGate({ onUnlocked }: Props) {
  const [mode, setMode] = useState<Mode>("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Cheap peek first — paint unlock/init UI without waiting on Argon2/DB.
        const peek = await api.vaultStatus();
        if (cancelled) return;

        if (!peek.canAutoUnlock) {
          setMode(peek.initialized ? "unlock" : "init");
          return;
        }

        setMode("auto");
        const auto = await api.vaultTryAutoUnlock();
        if (cancelled) return;
        if (auto.unlocked) {
          onUnlockedRef.current(auto);
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
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "init" || mode === "create") {
        if (password.length < 8) {
          toastErr("登录码至少 8 位");
          return;
        }
        if (password !== confirm) {
          toastErr("两次输入不一致");
          return;
        }
        const status = await api.vaultInit(password);
        onUnlockedRef.current(status);
      } else {
        const status = await api.vaultUnlock(password);
        onUnlockedRef.current(status);
      }
    } catch (e) {
      toastErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const waiting = mode === "loading" || mode === "auto";
  const title =
    mode === "init"
      ? "设置登录码以加密本地数据与同步凭证"
      : mode === "create"
        ? "创建新的独立数据空间（新登录码对应独立数据与远端配置）"
        : mode === "auto"
          ? "正在解锁本地数据…"
          : mode === "loading"
            ? "正在启动…"
            : "输入登录码解锁对应数据空间";

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
            placeholder="登录码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && !waiting && submit()}
            autoFocus={!waiting}
            disabled={waiting}
            autoComplete="new-password"
          />
          {(mode === "init" || mode === "create") && (
            <input
              className="unlock-input"
              type="password"
              placeholder="确认登录码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && submit()}
              autoComplete="new-password"
            />
          )}
          {password.length > 0 && (
            <p className="muted unlock-len">已输入 {password.length} 位</p>
          )}
          <button className="btn" disabled={busy || waiting} onClick={submit}>
            {busy
              ? "处理中…"
              : mode === "auto"
                ? "自动解锁中…"
                : mode === "loading"
                  ? "启动中…"
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

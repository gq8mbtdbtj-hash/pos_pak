import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { api, SyncPullResult, GitCommitInfo } from "../services/api";
import { showToast } from "./Toast";

type Props = {
  enabled: boolean;
  /** Lift FABs above bottom input docks */
  dockLift?: boolean;
};

type Side = "left" | "right";

const SIDE_KEY = "personal-os-sync-fab-side";

function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as { message?: string }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

function readSide(): Side {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    if (v === "left" || v === "right") return v;
  } catch {
    /* ignore */
  }
  return "right";
}

function IconPull() {
  return (
    <svg className="sync-fab__icon" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 4v11.2M8.2 11.5 12 15.3l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="19" r="1.55" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M7.5 19h3.1M13.4 19h3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPush() {
  return (
    <svg className="sync-fab__icon" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M7.2 17.2a4.2 4.2 0 0 1 .4-8.35 5.3 5.3 0 0 1 10.2 1.3 3.5 3.5 0 0 1 .5 6.95H7.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.2V9.4M9.4 11.6 12 9l2.6 2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Global pull / push FABs — drag sideways to pin left/right; opaque while working. */
export default function SyncFabs({ enabled, dockLift = false }: Props) {
  const [busy, setBusy] = useState<"pull" | "push" | null>(null);
  const [armed, setArmed] = useState<"pull" | "push" | null>(null);
  const [side, setSide] = useState<Side>(() => readSide());
  const [conflict, setConflict] = useState<SyncPullResult | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, side);
    } catch {
      /* ignore */
    }
  }, [side]);

  if (!enabled) return null;

  const blur = (el: EventTarget | null) => {
    if (el instanceof HTMLElement) el.blur();
  };

  const onClusterPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onClusterPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (Math.abs(e.clientX - d.startX) > 12) d.moved = true;
  };

  const onClusterPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 280);
    const mid = window.innerWidth / 2;
    const next: Side = e.clientX < mid ? "left" : "right";
    setSide(next);
    showToast("ok", next === "left" ? "同步按钮已移到左侧" : "同步按钮已移到右侧");
  };

  const pull = async (e: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) return;
    blur(e.currentTarget);
    if (busy) return;
    setArmed("pull");
    setBusy("pull");
    try {
      const r = await api.syncPull();
      if (r.status === "conflict") {
        setConflict(r);
        showToast("err", "存在冲突，请选择提交");
      } else {
        showToast(
          "ok",
          `拉取：${r.status}${r.revision ? ` @ ${r.revision.slice(0, 8)}` : ""}`,
        );
      }
    } catch (err) {
      showToast("err", errText(err));
    } finally {
      setBusy(null);
      window.setTimeout(() => setArmed(null), 220);
    }
  };

  const push = async (e: MouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) return;
    blur(e.currentTarget);
    if (busy) return;
    setArmed("push");
    setBusy("push");
    try {
      const r = await api.syncPush();
      if (r.status === "conflict") {
        setConflict(r);
        showToast("err", "存在冲突，请选择提交后再推送");
      } else {
        const label =
          r.status === "pushed"
            ? "已上传"
            : r.status === "up_to_date"
              ? "已是最新"
              : r.status;
        showToast(
          "ok",
          `推送：${label}${r.contentHash ? ` · ${r.contentHash.slice(0, 12)}` : ""}`,
        );
      }
    } catch (err) {
      showToast("err", errText(err));
    } finally {
      setBusy(null);
      window.setTimeout(() => setArmed(null), 220);
    }
  };

  const resolve = async (commit: GitCommitInfo) => {
    setBusy("pull");
    setArmed("pull");
    try {
      await api.syncResolveCommit(commit.id);
      setConflict(null);
      showToast("ok", `已采用 ${commit.shortId}`);
    } catch (err) {
      showToast("err", errText(err));
    } finally {
      setBusy(null);
      window.setTimeout(() => setArmed(null), 220);
    }
  };

  return (
    <>
      <div
        className={[
          "sync-fabs",
          side === "left" ? "sync-fabs--left" : "sync-fabs--right",
          dockLift ? "sync-fabs--dock" : "",
          busy ? "is-working" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="同步（左右拖动可换边）"
        title="左右拖动可切换位置"
        onPointerDown={onClusterPointerDown}
        onPointerMove={onClusterPointerMove}
        onPointerUp={onClusterPointerUp}
        onPointerCancel={onClusterPointerUp}
      >
        <button
          type="button"
          className={`sync-fab${armed === "pull" || busy === "pull" ? " is-armed" : ""}${
            busy === "pull" ? " is-busy" : ""
          }`}
          disabled={busy !== null}
          aria-label="拉取远端"
          title="拉取"
          onClick={pull}
        >
          {busy === "pull" ? <span className="sync-fab__busy">…</span> : <IconPull />}
        </button>
        <button
          type="button"
          className={`sync-fab${armed === "push" || busy === "push" ? " is-armed" : ""}${
            busy === "push" ? " is-busy" : ""
          }`}
          disabled={busy !== null}
          aria-label="推送到远端"
          title="推送"
          onClick={push}
        >
          {busy === "push" ? <span className="sync-fab__busy">…</span> : <IconPush />}
        </button>
      </div>

      {conflict?.conflict && (
        <div className="sync-conflict-backdrop" role="presentation">
          <div className="sync-conflict-card" role="dialog" aria-label="同步冲突">
            <h3>选择提交以解决冲突</h3>
            <p className="muted">{conflict.conflict.message}</p>
            <ul className="commit-list">
              {conflict.conflict.commits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="btn commit-pick"
                    disabled={busy !== null}
                    onClick={() => resolve(c)}
                  >
                    <strong>{c.shortId}</strong>
                    <span>{c.summary}</span>
                    <span className="muted">
                      {c.author} · {c.time}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={(e) => {
                blur(e.currentTarget);
                setConflict(null);
              }}
            >
              稍后处理
            </button>
          </div>
        </div>
      )}
    </>
  );
}
